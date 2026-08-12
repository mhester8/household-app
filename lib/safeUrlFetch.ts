// Minimal SSRF-safe fetcher for the URL recipe importer: validates the
// scheme, resolves the hostname and rejects private/loopback/link-local/
// reserved destinations, and re-validates on every redirect hop (redirects
// are followed manually since automatic redirect-following would bypass
// this check). This is scoped to exactly what the recipe URL importer
// needs — not a general-purpose networking/security module.
//
// Known v1 limitation: the safety check resolves DNS once per hop and then
// lets `fetch` resolve the same hostname again to actually connect. A
// classic "DNS rebinding" attack (the name resolving to a safe address at
// check-time and a private one moments later at connect-time) isn't closed
// by this. Closing it fully would mean pinning the TCP connection to the
// checked IP via a custom dispatcher, which is more machinery than this
// household app's threat model (two authenticated users) currently
// justifies — noted here so it's a deliberate, visible tradeoff rather than
// an oversight.

import { lookup } from "node:dns/promises";

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 3 * 1024 * 1024; // generous for an HTML page
const USER_AGENT = "HesterHouseRecipeImporter/1.0";

export type SafeFetchResult =
  | { ok: true; html: string; finalUrl: string }
  | { ok: false; reason: "invalid_url" | "blocked_destination" | "fetch_failed" };

function isPrivateOrReservedIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return true; // fail closed on anything we can't parse
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + broadcast
  return false;
}

function isPrivateOrReservedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified

  const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateOrReservedIPv4(mapped[1]);

  const firstGroup = lower.split(":").find((part) => part !== "") ?? "";
  const value = Number.parseInt(firstGroup, 16);
  if (Number.isNaN(value)) return true; // fail closed

  if (value >= 0xfe80 && value <= 0xfebf) return true; // fe80::/10 link-local
  if (value >= 0xfc00 && value <= 0xfdff) return true; // fc00::/7 unique local
  return false;
}

async function isSafeDestination(url: URL): Promise<boolean> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }

  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    return false; // unresolvable host — treat as unsafe rather than let fetch() surface a raw DNS error
  }

  if (addresses.length === 0) {
    return false;
  }

  return addresses.every(({ address, family }) =>
    family === 6 ? !isPrivateOrReservedIPv6(address) : !isPrivateOrReservedIPv4(address)
  );
}

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return response.text();
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
    }
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf-8");
}

// Fetches a recipe page: only http(s), only GET, no forwarded credentials,
// a timeout per request, a response-size cap, and redirects followed by
// hand (up to MAX_REDIRECTS hops) with the destination re-validated before
// every single fetch — including the first one.
export async function safeFetchRecipePage(rawUrl: string): Promise<SafeFetchResult> {
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await isSafeDestination(current))) {
      return { ok: false, reason: "blocked_destination" };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      });
    } catch {
      return { ok: false, reason: "fetch_failed" };
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return { ok: false, reason: "fetch_failed" };
      }
      try {
        current = new URL(location, current);
      } catch {
        return { ok: false, reason: "fetch_failed" };
      }
      continue; // loop re-validates `current` at the top before following it
    }

    if (!response.ok) {
      return { ok: false, reason: "fetch_failed" };
    }

    const html = await readBodyWithLimit(response, MAX_RESPONSE_BYTES);
    return { ok: true, html, finalUrl: current.toString() };
  }

  return { ok: false, reason: "fetch_failed" }; // exceeded MAX_REDIRECTS
}

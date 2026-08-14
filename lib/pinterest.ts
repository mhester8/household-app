import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Pinterest API v5. See developers.pinterest.com/docs/getting-started/
// set-up-authentication-and-authorization/ — confirmed: confidential-client
// token requests authenticate with HTTP Basic (client_id:client_secret), not
// PKCE (PKCE isn't mentioned anywhere in Pinterest's docs for this flow).
export const PINTEREST_AUTHORIZE_URL = "https://www.pinterest.com/oauth/";
export const PINTEREST_TOKEN_URL = "https://api.pinterest.com/v5/oauth/token";
export const PINTEREST_BOARDS_URL = "https://api.pinterest.com/v5/boards";

// Read-only board- and pin-listing scopes. Still no user_accounts:read (we
// don't call /v5/user_account). Pinterest's scope param is comma-separated,
// not space-separated like standard OAuth — confirmed from Pinterest's own
// example authorize URLs.
//
// Connections made before pins:read was added were authorized with
// boards:read only. A refresh can never widen a token's scope (Pinterest's
// refresh grant only narrows it), so those connections must reconnect once
// to pick up pins:read — see the insufficient_scope handling in
// fetchPinterestBoardPins/the boards/[boardId]/pins route.
export const PINTEREST_SCOPES = "boards:read,pins:read";

// Both OAuth cookies are scoped to this path so they're never sent on
// unrelated requests, and both are cleared once consumed.
export const PINTEREST_COOKIE_PATH = "/api/pinterest";
export const OAUTH_STATE_COOKIE = "pinterest_oauth_state";
export const OAUTH_PENDING_COOKIE = "pinterest_oauth_pending";
export const OAUTH_COOKIE_MAX_AGE_SECONDS = 600;

// Refresh proactively rather than waiting for a 401 from Pinterest — avoids
// a user-visible failure on the boards call for a token that's about to
// expire mid-request.
const REFRESH_SAFETY_WINDOW_MS = 5 * 60 * 1000;

export function getPinterestCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.PINTEREST_CLIENT_ID;
  const clientSecret = process.env.PINTEREST_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return null;
  }
  return { clientId, clientSecret };
}

export function getPinterestRedirectUri(requestUrl: string): string {
  return new URL("/api/pinterest/callback", requestUrl).toString();
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

type PinterestTokenResponse = {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  refresh_token_expires_in?: number;
  scope: string;
};

export type PinterestTokenResult =
  | { ok: true; data: PinterestTokenResponse }
  | { ok: false; status: number; message: string };

async function requestPinterestToken(
  body: URLSearchParams,
  clientId: string,
  clientSecret: string
): Promise<PinterestTokenResult> {
  let response: Response;
  try {
    response = await fetch(PINTEREST_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(clientId, clientSecret),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
  } catch {
    return { ok: false, status: 502, message: "Couldn't reach Pinterest." };
  }

  if (!response.ok) {
    // Never reflect Pinterest's raw error body to the client — same
    // vague-on-failure discipline as safeFetchRecipePage.
    return { ok: false, status: response.status, message: "Pinterest rejected the request." };
  }

  try {
    const data = (await response.json()) as PinterestTokenResponse;
    return { ok: true, data };
  } catch {
    return { ok: false, status: 502, message: "Pinterest returned an unreadable response." };
  }
}

export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string
): Promise<PinterestTokenResult> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  return requestPinterestToken(body, clientId, clientSecret);
}

export async function refreshPinterestToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<PinterestTokenResult> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: PINTEREST_SCOPES,
  });
  return requestPinterestToken(body, clientId, clientSecret);
}

export type PendingPinterestTokens = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  scope: string;
};

export function tokenResponseToPending(data: PinterestTokenResponse, issuedAtMs: number): PendingPinterestTokens | null {
  // A first-time exchange always includes a refresh_token; if it's ever
  // absent there's nothing usable to store.
  if (!data.refresh_token) {
    return null;
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    accessTokenExpiresAt: new Date(issuedAtMs + data.expires_in * 1000).toISOString(),
    refreshTokenExpiresAt: new Date(
      issuedAtMs + (data.refresh_token_expires_in ?? 60 * 24 * 60 * 60) * 1000
    ).toISOString(),
    scope: data.scope,
  };
}

export type PinterestConnectionRow = {
  user_id: string;
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string;
  refresh_token_expires_at: string;
  scope: string;
  created_at: string;
  updated_at: string;
};

// Scoped to the current request's Supabase access token (not the anon key
// alone) so RLS's auth.uid() resolves to the caller — this is what lets
// finish-connect and boards write/read pinterest_connections without a
// service-role key.
export function getUserScopedSupabaseClient(accessToken: string): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase environment variables.");
  }
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function upsertPinterestConnection(
  client: SupabaseClient,
  userId: string,
  tokens: PendingPinterestTokens
): Promise<string | null> {
  const { error } = await client.from("pinterest_connections").upsert(
    {
      user_id: userId,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      access_token_expires_at: tokens.accessTokenExpiresAt,
      refresh_token_expires_at: tokens.refreshTokenExpiresAt,
      scope: tokens.scope,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  return error?.message ?? null;
}

export type AccessTokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; reason: "not_connected" | "refresh_failed" | "misconfigured" };

// Loads the caller's stored connection and returns a usable access token,
// refreshing lazily (inline, no background job) when it's expired or close
// to it. Defensively persists a rotated refresh_token if Pinterest returns
// one; keeps the existing refresh_token and its expiry untouched otherwise,
// since Pinterest's docs don't guarantee refresh_token rotation on every
// call.
export async function getValidPinterestAccessToken(
  client: SupabaseClient,
  userId: string
): Promise<AccessTokenResult> {
  const { data: row, error } = await client
    .from("pinterest_connections")
    .select("*")
    .maybeSingle<PinterestConnectionRow>();

  if (error || !row) {
    return { ok: false, reason: "not_connected" };
  }

  const expiresAtMs = new Date(row.access_token_expires_at).getTime();
  if (expiresAtMs - Date.now() > REFRESH_SAFETY_WINDOW_MS) {
    return { ok: true, accessToken: row.access_token };
  }

  const credentials = getPinterestCredentials();
  if (!credentials) {
    return { ok: false, reason: "misconfigured" };
  }

  const refreshResult = await refreshPinterestToken(row.refresh_token, credentials.clientId, credentials.clientSecret);
  if (!refreshResult.ok) {
    return { ok: false, reason: "refresh_failed" };
  }

  const issuedAtMs = Date.now();
  const nextAccessTokenExpiresAt = new Date(issuedAtMs + refreshResult.data.expires_in * 1000).toISOString();
  const nextRefreshToken = refreshResult.data.refresh_token ?? row.refresh_token;
  const nextRefreshTokenExpiresAt = refreshResult.data.refresh_token_expires_in
    ? new Date(issuedAtMs + refreshResult.data.refresh_token_expires_in * 1000).toISOString()
    : row.refresh_token_expires_at;

  await client
    .from("pinterest_connections")
    .update({
      access_token: refreshResult.data.access_token,
      refresh_token: nextRefreshToken,
      access_token_expires_at: nextAccessTokenExpiresAt,
      refresh_token_expires_at: nextRefreshTokenExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  return { ok: true, accessToken: refreshResult.data.access_token };
}

export type PinterestBoardSummary = { id: string; name: string };

export type BoardsResult =
  | { ok: true; boards: PinterestBoardSummary[] }
  | { ok: false; status: number };

export async function fetchPinterestBoards(accessToken: string): Promise<BoardsResult> {
  let response: Response;
  try {
    response = await fetch(PINTEREST_BOARDS_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    return { ok: false, status: 502 };
  }

  if (!response.ok) {
    return { ok: false, status: response.status };
  }

  try {
    const body = (await response.json()) as { items?: Array<{ id?: unknown; name?: unknown }> };
    const boards = (body.items ?? [])
      .filter((item): item is { id: string; name: string } => typeof item.id === "string" && typeof item.name === "string")
      .map((item) => ({ id: item.id, name: item.name }));
    return { ok: true, boards };
  } catch {
    return { ok: false, status: 502 };
  }
}

// Pinterest board and Pin ids are numeric strings. Validating this before
// ever interpolating the value into a URL means an unexpected value 400s
// immediately instead of being sent on to Pinterest as part of a request path.
const PINTEREST_ID_PATTERN = /^\d{1,32}$/;

export function isValidPinterestId(value: string): boolean {
  return PINTEREST_ID_PATTERN.test(value);
}

export type PinterestPinSummary = {
  id: string;
  title: string | null;
  // Pinterest's own caption/description field, distinct from title — useful
  // context for the image-import fallback (see /api/import-recipe-pin) but
  // never itself a source of ingredients/steps.
  description: string | null;
  imageUrl: string | null;
  // A larger rendition of the same image than `imageUrl`, used only when a
  // link-less Pin is sent to the vision importer — the grid thumbnail is
  // deliberately small and isn't sharp enough to read printed recipe text
  // off of. Falls back to `imageUrl` itself when no larger size is present.
  extractionImageUrl: string | null;
  link: string | null;
};

export type BoardPinsResult =
  | { ok: true; pins: PinterestPinSummary[]; nextBookmark: string | null }
  | { ok: false; status: number };

function firstImageUrl(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const entry = record[key];
    if (entry && typeof entry === "object" && typeof (entry as { url?: unknown }).url === "string") {
      return (entry as { url: string }).url;
    }
  }
  return null;
}

// Picks one reasonable thumbnail size for a grid — this milestone only
// needs enough to identify a Pin, not the full-resolution image, and there's
// no image caching/storage involved (Pinterest's own CDN URL is used as-is).
function pickThumbnailUrl(images: unknown): string | null {
  if (typeof images !== "object" || images === null) {
    return null;
  }
  const record = images as Record<string, unknown>;
  const picked = firstImageUrl(record, ["400x300", "150x150"]);
  if (picked) {
    return picked;
  }
  const firstEntry = Object.values(record)[0];
  if (firstEntry && typeof firstEntry === "object" && typeof (firstEntry as { url?: unknown }).url === "string") {
    return (firstEntry as { url: string }).url;
  }
  return null;
}

// Picks the largest available rendition for feeding to the vision model —
// legible ingredient/step text needs real resolution, unlike the grid
// thumbnail. Falls back through progressively smaller sizes, then to
// whatever pickThumbnailUrl would have picked, so this never fails to
// return something as long as the Pin has any image at all.
function pickExtractionImageUrl(images: unknown, thumbnailUrl: string | null): string | null {
  if (typeof images !== "object" || images === null) {
    return thumbnailUrl;
  }
  const record = images as Record<string, unknown>;
  return firstImageUrl(record, ["orig", "1200x", "600x", "600x315"]) ?? thumbnailUrl;
}

// Defense-in-depth check applied right before a Pin image URL is ever sent
// on to OpenAI (see /api/import-recipe-pin): Pinterest's own API is the only
// source of these URLs today, but this guards against a future bug or an
// unexpected response shape quietly turning into "send an arbitrary URL to
// a third party." Exact-hostname match, not a suffix check, so it can't be
// satisfied by an attacker-controlled subdomain like "i.pinimg.com.evil.com".
const PINTEREST_IMAGE_CDN_HOSTNAME = "i.pinimg.com";

export function isPinterestImageCdnUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname === PINTEREST_IMAGE_CDN_HOSTNAME;
  } catch {
    return false;
  }
}

export async function fetchPinterestBoardPins(
  accessToken: string,
  boardId: string,
  bookmark: string | null
): Promise<BoardPinsResult> {
  const url = new URL(`${PINTEREST_BOARDS_URL}/${boardId}/pins`);
  if (bookmark) {
    url.searchParams.set("bookmark", bookmark);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    return { ok: false, status: 502 };
  }

  if (!response.ok) {
    return { ok: false, status: response.status };
  }

  try {
    const body = (await response.json()) as {
      items?: Array<{
        id?: unknown;
        title?: unknown;
        description?: unknown;
        link?: unknown;
        media?: { images?: unknown };
      }>;
      bookmark?: unknown;
    };
    const pins = (body.items ?? [])
      .filter(
        (
          item
        ): item is {
          id: string;
          title?: unknown;
          description?: unknown;
          link?: unknown;
          media?: { images?: unknown };
        } => typeof item.id === "string"
      )
      .map((item) => {
        const thumbnailUrl = pickThumbnailUrl(item.media?.images);
        return {
          id: item.id,
          title: typeof item.title === "string" && item.title.trim() !== "" ? item.title : null,
          description:
            typeof item.description === "string" && item.description.trim() !== "" ? item.description : null,
          imageUrl: thumbnailUrl,
          extractionImageUrl: pickExtractionImageUrl(item.media?.images, thumbnailUrl),
          // Not trusted as inherently safe just because it came from Pinterest
          // — passed through unmodified to the existing recipe URL importer,
          // which applies the same isFetchableUrl check and server-side
          // SSRF-safe fetch it already applies to a manually typed URL.
          link: typeof item.link === "string" && item.link.trim() !== "" ? item.link : null,
        };
      });
    const nextBookmark = typeof body.bookmark === "string" ? body.bookmark : null;
    return { ok: true, pins, nextBookmark };
  } catch {
    return { ok: false, status: 502 };
  }
}

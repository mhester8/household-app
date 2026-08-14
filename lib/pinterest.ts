import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Pinterest API v5. See developers.pinterest.com/docs/getting-started/
// set-up-authentication-and-authorization/ — confirmed: confidential-client
// token requests authenticate with HTTP Basic (client_id:client_secret), not
// PKCE (PKCE isn't mentioned anywhere in Pinterest's docs for this flow).
export const PINTEREST_AUTHORIZE_URL = "https://www.pinterest.com/oauth/";
export const PINTEREST_TOKEN_URL = "https://api.pinterest.com/v5/oauth/token";
export const PINTEREST_BOARDS_URL = "https://api.pinterest.com/v5/boards";

// Read-only, board-listing scope only for this milestone — no
// user_accounts:read (we don't call /v5/user_account), no pins:read.
export const PINTEREST_SCOPES = "boards:read";

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

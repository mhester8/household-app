import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  OAUTH_COOKIE_MAX_AGE_SECONDS,
  OAUTH_STATE_COOKIE,
  PINTEREST_AUTHORIZE_URL,
  PINTEREST_COOKIE_PATH,
  PINTEREST_SCOPES,
  getPinterestCredentials,
  getPinterestRedirectUri,
} from "@/lib/pinterest";

// A normal browser navigation to this route wouldn't carry the Supabase
// Bearer token, so this is a POST called from the authenticated /pinterest
// page — same Bearer-token pattern as the other API routes — which then
// returns the Pinterest authorize URL for the browser to navigate to itself.
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: "Server is misconfigured." }, { status: 500 });
  }

  // Same pattern as /api/import-recipe-url and friends, no service-role secret.
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data: userData, error: userError } = await supabase.auth.getUser(token);

  if (userError || !userData?.user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const credentials = getPinterestCredentials();
  if (!credentials) {
    return NextResponse.json({ error: "Server is misconfigured." }, { status: 500 });
  }

  const state = randomBytes(32).toString("hex");
  const redirectUri = getPinterestRedirectUri(request.url);

  const authorizeUrl = new URL(PINTEREST_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", credentials.clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", PINTEREST_SCOPES);
  authorizeUrl.searchParams.set("state", state);

  const response = NextResponse.json({ url: authorizeUrl.toString() });
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: PINTEREST_COOKIE_PATH,
    maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS,
  });

  return response;
}

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  OAUTH_PENDING_COOKIE,
  PINTEREST_COOKIE_PATH,
  type PendingPinterestTokens,
  getUserScopedSupabaseClient,
  upsertPinterestConnection,
} from "@/lib/pinterest";

function isPendingTokens(value: unknown): value is PendingPinterestTokens {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.accessToken === "string" &&
    typeof record.refreshToken === "string" &&
    typeof record.accessTokenExpiresAt === "string" &&
    typeof record.refreshTokenExpiresAt === "string" &&
    typeof record.scope === "string"
  );
}

// Called by the browser (with its own current Supabase session) right after
// the callback redirects to /pinterest?connected=1. Doing the RLS-protected
// write here — using a Supabase client scoped to *this* request's access
// token — means it needs no service-role key and no novel auth mechanism:
// it's the same Bearer-token pattern as every other route in this app.
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

  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: userData, error: userError } = await authClient.auth.getUser(token);

  if (userError || !userData?.user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const pendingCookie = request.cookies.get(OAUTH_PENDING_COOKIE)?.value;
  if (!pendingCookie) {
    return NextResponse.json(
      { error: "No pending Pinterest connection found. Try connecting again.", reason: "missing_pending" },
      { status: 400 }
    );
  }

  let pending: unknown;
  try {
    pending = JSON.parse(pendingCookie);
  } catch {
    const response = NextResponse.json(
      { error: "Your Pinterest connection attempt expired. Try connecting again.", reason: "missing_pending" },
      { status: 400 }
    );
    response.cookies.delete({ name: OAUTH_PENDING_COOKIE, path: PINTEREST_COOKIE_PATH });
    return response;
  }

  if (!isPendingTokens(pending)) {
    const response = NextResponse.json(
      { error: "Your Pinterest connection attempt expired. Try connecting again.", reason: "missing_pending" },
      { status: 400 }
    );
    response.cookies.delete({ name: OAUTH_PENDING_COOKIE, path: PINTEREST_COOKIE_PATH });
    return response;
  }

  // Scoped to this request's own live access token, not anything carried
  // over from earlier in the flow — auth.uid() resolves to the current user.
  const userScopedClient = getUserScopedSupabaseClient(token);
  const upsertError = await upsertPinterestConnection(userScopedClient, userData.user.id, pending);

  if (upsertError) {
    // Deliberately leave the pending cookie in place so a retry (e.g. the
    // user refreshing the page) can attempt the write again without redoing
    // the Pinterest consent screen.
    return NextResponse.json(
      { error: "Couldn't save your Pinterest connection. Try again.", reason: "upsert_failed" },
      { status: 502 }
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.delete({ name: OAUTH_PENDING_COOKIE, path: PINTEREST_COOKIE_PATH });
  return response;
}

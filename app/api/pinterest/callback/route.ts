import { NextResponse, type NextRequest } from "next/server";
import {
  OAUTH_COOKIE_MAX_AGE_SECONDS,
  OAUTH_PENDING_COOKIE,
  OAUTH_STATE_COOKIE,
  PINTEREST_COOKIE_PATH,
  exchangeCodeForToken,
  getPinterestCredentials,
  getPinterestRedirectUri,
  tokenResponseToPending,
} from "@/lib/pinterest";

// Pinterest redirects the browser here (GET, no Authorization header). This
// route only ever redirects to a fixed internal path (/pinterest) — never to
// a request-controlled destination — and never returns tokens to the
// browser as a JSON body or query param.
function redirectToApp(request: NextRequest, params?: Record<string, string>) {
  const url = new URL("/pinterest", request.url);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return NextResponse.redirect(url);
}

function clearStateCookie(response: NextResponse) {
  response.cookies.delete({ name: OAUTH_STATE_COOKIE, path: PINTEREST_COOKIE_PATH });
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  // The user declined on Pinterest's consent screen, or Pinterest reported
  // some other authorization error.
  if (searchParams.get("error")) {
    const response = redirectToApp(request, { pinterest_error: "access_denied" });
    clearStateCookie(response);
    return response;
  }

  const code = searchParams.get("code");
  const returnedState = searchParams.get("state");
  const cookieState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;

  if (!code || !returnedState || !cookieState || returnedState !== cookieState) {
    const response = redirectToApp(request, { pinterest_error: "invalid_state" });
    clearStateCookie(response);
    return response;
  }

  const credentials = getPinterestCredentials();
  if (!credentials) {
    const response = redirectToApp(request, { pinterest_error: "misconfigured" });
    clearStateCookie(response);
    return response;
  }

  const redirectUri = getPinterestRedirectUri(request.url);
  const tokenResult = await exchangeCodeForToken(code, redirectUri, credentials.clientId, credentials.clientSecret);

  if (!tokenResult.ok) {
    const response = redirectToApp(request, { pinterest_error: "exchange_failed" });
    clearStateCookie(response);
    return response;
  }

  const pending = tokenResponseToPending(tokenResult.data, Date.now());
  if (!pending) {
    const response = redirectToApp(request, { pinterest_error: "exchange_failed" });
    clearStateCookie(response);
    return response;
  }

  const response = redirectToApp(request, { connected: "1" });
  clearStateCookie(response);
  response.cookies.set(OAUTH_PENDING_COOKIE, JSON.stringify(pending), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: PINTEREST_COOKIE_PATH,
    maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS,
  });

  return response;
}

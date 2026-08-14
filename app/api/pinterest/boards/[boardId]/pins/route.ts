import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchPinterestBoardPins, getUserScopedSupabaseClient, getValidPinterestAccessToken, isValidPinterestId } from "@/lib/pinterest";

export async function GET(request: NextRequest, { params }: { params: Promise<{ boardId: string }> }) {
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

  const { boardId } = await params;
  if (!isValidPinterestId(boardId)) {
    return NextResponse.json({ error: "Invalid board." }, { status: 400 });
  }

  const bookmark = request.nextUrl.searchParams.get("bookmark");

  const userScopedClient = getUserScopedSupabaseClient(token);
  const tokenResult = await getValidPinterestAccessToken(userScopedClient, userData.user.id);

  if (!tokenResult.ok) {
    if (tokenResult.reason === "not_connected") {
      return NextResponse.json(
        { error: "Pinterest isn't connected yet.", reason: "not_connected" },
        { status: 404 }
      );
    }
    if (tokenResult.reason === "refresh_failed") {
      return NextResponse.json(
        { error: "Your Pinterest connection needs to be reconnected.", reason: "refresh_failed" },
        { status: 502 }
      );
    }
    return NextResponse.json({ error: "Server is misconfigured." }, { status: 500 });
  }

  const pinsResult = await fetchPinterestBoardPins(tokenResult.accessToken, boardId, bookmark);

  if (!pinsResult.ok) {
    // A stored connection made before pins:read was requested can't read
    // Pins — Pinterest's refresh grant can only narrow scope, never widen
    // it, so the only fix is reconnecting to re-consent with the new scope.
    if (pinsResult.status === 403) {
      return NextResponse.json(
        { error: "Reconnect Pinterest to grant access to Pins.", reason: "insufficient_scope" },
        { status: 403 }
      );
    }
    return NextResponse.json(
      { error: "Couldn't load this board's Pins right now. Try again.", reason: "pins_fetch_failed" },
      { status: 502 }
    );
  }

  return NextResponse.json({ pins: pinsResult.pins, nextBookmark: pinsResult.nextBookmark });
}

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchPinterestBoards, getUserScopedSupabaseClient, getValidPinterestAccessToken } from "@/lib/pinterest";

export async function GET(request: NextRequest) {
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

  const boardsResult = await fetchPinterestBoards(tokenResult.accessToken);

  if (!boardsResult.ok) {
    return NextResponse.json(
      { error: "Couldn't load your Pinterest boards right now. Try again.", reason: "boards_fetch_failed" },
      { status: 502 }
    );
  }

  return NextResponse.json({ boards: boardsResult.boards });
}

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { RecipeImportDraft } from "@/lib/recipes";
import { safeFetchRecipePage } from "@/lib/safeUrlFetch";
import { extractJsonLdBlocks, findRecipeNode, normalizeRecipeNode, hasUsableContent } from "@/lib/recipeJsonLd";

// Machine-readable reason alongside the human-readable `error` string, so
// the client can decide which review-flow step to show (a fetch problem vs.
// "we loaded the page but found nothing usable") without re-deriving it
// from message text.
type ImportUrlErrorReason =
  | "invalid_url"
  | "blocked_destination"
  | "fetch_failed"
  | "no_structured_data"
  | "unusable_structured_data";

function errorResponse(reason: ImportUrlErrorReason, message: string, status: number) {
  return NextResponse.json({ error: message, reason }, { status });
}

export async function POST(request: Request) {
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

  // Verify the caller's token against Supabase Auth using only the public
  // anon key — same pattern as /api/import-recipe and /api/group-groceries,
  // no service-role secret.
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data: userData, error: userError } = await supabase.auth.getUser(token);

  if (userError || !userData?.user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_url", "That doesn't look like a valid web address.", 400);
  }

  const rawUrl = (body as { url?: unknown } | null)?.url;
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
    return errorResponse("invalid_url", "Enter a recipe URL.", 400);
  }

  const trimmedUrl = rawUrl.trim();
  try {
    const parsed = new URL(trimmedUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    return errorResponse("invalid_url", "That doesn't look like a valid web address.", 400);
  }

  const fetchResult = await safeFetchRecipePage(trimmedUrl);

  if (!fetchResult.ok) {
    // Deliberately vague to the client either way — never reflect raw
    // fetch/DNS/network errors, and don't reveal that a URL was blocked as
    // an SSRF target vs. simply unreachable.
    const message =
      fetchResult.reason === "invalid_url"
        ? "That doesn't look like a valid web address."
        : "Couldn't load that page. Check the link and try again.";
    return errorResponse(fetchResult.reason, message, 422);
  }

  const blocks = extractJsonLdBlocks(fetchResult.html);
  const recipeNode = findRecipeNode(blocks);

  if (!recipeNode) {
    return errorResponse(
      "no_structured_data",
      "No recipe data found on that page. You can add this recipe manually instead.",
      422
    );
  }

  const normalized = normalizeRecipeNode(recipeNode);

  if (!hasUsableContent(normalized)) {
    return errorResponse(
      "unusable_structured_data",
      "Found recipe data on that page, but couldn't read enough of it to import. You can add this recipe manually instead.",
      422
    );
  }

  const draft: RecipeImportDraft = {
    title: normalized.title,
    ingredients: normalized.ingredients,
    steps: normalized.steps,
    warnings: [],
    sourceUrl: fetchResult.finalUrl,
    servings: normalized.servings,
    prepTimeMinutes: normalized.prepTimeMinutes,
    cookTimeMinutes: normalized.cookTimeMinutes,
    totalTimeMinutes: normalized.totalTimeMinutes,
  };

  return NextResponse.json(draft);
}

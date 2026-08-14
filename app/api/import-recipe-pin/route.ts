import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { isPinterestImageCdnUrl } from "@/lib/pinterest";
import { runRecipeImportExtraction } from "@/lib/recipeImportModel";

// Extracts a recipe from a single Pinterest Pin's own image — the fallback
// for Pins with no destination `link` (see /api/import-recipe-url for the
// normal case). The image is handed to OpenAI as the Pinterest CDN URL
// directly rather than fetched and re-encoded here: a smoke test confirmed
// gpt-5.6-terra's Responses API reliably retrieves a public i.pinimg.com
// URL passed as `input_image.image_url`, so there's no reason for this
// server to open a socket to a Pinterest-supplied URL at all — the
// CDN-hostname check below is the only validation this route needs to do
// on it.
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
  // anon key — same pattern as /api/import-recipe and /api/import-recipe-url,
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
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const record = (body as Record<string, unknown> | null) ?? {};
  const imageUrl = typeof record.imageUrl === "string" ? record.imageUrl : null;
  const title = typeof record.title === "string" && record.title.trim() !== "" ? record.title.trim() : null;
  const description =
    typeof record.description === "string" && record.description.trim() !== "" ? record.description.trim() : null;

  if (!imageUrl || !isPinterestImageCdnUrl(imageUrl)) {
    return NextResponse.json({ error: "That Pin doesn't have an image to read." }, { status: 400 });
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const contextLines = [
    title ? `Pin title: ${title}` : null,
    description ? `Pin description: ${description}` : null,
  ].filter((line): line is string => line !== null);

  try {
    const draft = await runRecipeImportExtraction(
      openai,
      [
        {
          role: "system",
          content:
            "You extract recipes from a single Pinterest Pin image. The Pin's title and " +
            "description, if given, are supplied only as context to help you understand what " +
            "dish is shown — they are never a source of ingredients, quantities, temperatures, " +
            "times, or instructions. Only populate those fields when the information is literally " +
            "printed or handwritten and legible within the image itself.\n\n" +
            "Never generate or infer a recipe merely because the image shows or names a dish. If " +
            "the image is just a photo of the finished food, a decorative title or text overlay " +
            "naming the dish, or marketing copy, do not invent a plausible recipe for it — for " +
            "example, do not turn a title like 'Maple Dijon Salmon' into an invented ingredient " +
            "list or steps. Never fill in plausible-sounding quantities, temperatures, times, or " +
            "instructions from general culinary knowledge — only report what is literally visible " +
            "as text in the image. If the image does not visibly contain a written ingredient " +
            "list or written instructions, return a null title and empty ingredients and steps " +
            "arrays, exactly as if no recipe were present, even if the title or description " +
            "describes a specific dish.\n\n" +
            "If the image does visibly contain a written ingredient list and/or written " +
            "instructions — a recipe card, an infographic-style recipe, a screenshot of a recipe, " +
            "a handwritten recipe — extract only the ingredient lines and steps that are actually " +
            "legible, exactly as they read. Preserve each ingredient line as useful free text " +
            "exactly as it reads (for example '1 pound ground turkey') — do not split it into " +
            "quantity/unit/name fields, and do not invent units or amounts that aren't shown. " +
            "Preserve the order of ingredients and steps, and preserve the meaning of the source " +
            "rather than rewriting it stylistically. If only part of a real written recipe is " +
            "visible — a section is cut off, blurry, or otherwise unclear — extract whatever is " +
            "readable and add a warning describing what's missing or unclear instead of guessing " +
            "at it.\n\n" +
            "If a servings count or yield is clearly printed (for example '4 servings', 'Serves " +
            "6'), put it in the servings field exactly as written. Leave servings null if it isn't " +
            "stated or isn't clearly legible — never guess or estimate one. If prep time, cook " +
            "time, and/or total time are clearly printed, convert each to a whole number of " +
            "minutes and put it in the matching field (prepTimeMinutes, cookTimeMinutes, " +
            "totalTimeMinutes); only fill in a field when its value is directly stated in the " +
            "image, never calculated or estimated from another. Leave a time field null if it " +
            "isn't clearly stated or isn't legible.",
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                (contextLines.length > 0
                  ? `${contextLines.join("\n")}\n\n`
                  : "") + "Extract the recipe from this Pinterest Pin image, if one is actually visible in it.",
            },
            { type: "input_image", image_url: imageUrl, detail: "high" },
          ],
        },
      ],
      imageUrl
    );

    return NextResponse.json(draft);
  } catch (err) {
    console.error("OpenAI Pinterest Pin recipe import failed:", err);
    return NextResponse.json({ error: "Couldn't read that Pin right now. Try again." }, { status: 502 });
  }
}

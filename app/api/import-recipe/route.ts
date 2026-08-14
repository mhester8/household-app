import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import type { RecipeImportDraft } from "@/lib/recipes";
import { runRecipeImportExtraction } from "@/lib/recipeImportModel";
import { MAX_IMPORT_IMAGES, MAX_TOTAL_IMPORT_IMAGE_BYTES } from "@/lib/recipeImportLimits";

// The client compresses photos to well under 2MB before uploading; this is a
// generous hard backstop against a client that skipped compression (e.g. a
// browser where canvas re-encoding failed and the original file was sent).
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// The client always re-encodes to JPEG. PNG/WebP are accepted too in case a
// browser can't compress (screenshots are already PNG and often small enough
// to send as-is).
const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

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
  // anon key — same pattern as /api/group-groceries, no service-role secret.
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data: userData, error: userError } = await supabase.auth.getUser(token);

  if (userError || !userData?.user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }

  const files = formData.getAll("images").filter((entry): entry is File => entry instanceof File);

  if (files.length === 0) {
    return NextResponse.json({ error: "No images were provided." }, { status: 400 });
  }

  if (files.length > MAX_IMPORT_IMAGES) {
    return NextResponse.json(
      { error: `You can import up to ${MAX_IMPORT_IMAGES} images at a time. Remove some and try again.` },
      { status: 400 }
    );
  }

  for (const file of files) {
    if (file.size === 0) {
      return NextResponse.json({ error: "One of the selected images is empty." }, { status: 400 });
    }
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Unsupported image type. Please upload JPEG, PNG, or WebP photos." },
        { status: 400 }
      );
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "One of the selected images is too large." }, { status: 400 });
    }
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_TOTAL_IMPORT_IMAGE_BYTES) {
    return NextResponse.json(
      { error: "These images are too large together. Remove one or try smaller photos." },
      { status: 400 }
    );
  }

  // The images only ever exist in this request's memory: each is read into a
  // buffer, base64-encoded for the OpenAI call below, and never written to
  // Supabase, Storage, or disk. Nothing here outlives this request.
  const dataUrls = await Promise.all(
    files.map(async (file) => {
      const bytes = await file.arrayBuffer();
      return `data:${file.type};base64,${Buffer.from(bytes).toString("base64")}`;
    })
  );

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  let draft: RecipeImportDraft;

  try {
    draft = await runRecipeImportExtraction(
      openai,
      [
        {
          role: "system",
          content:
            "You extract recipes from photos: cookbook pages, magazine clippings, printed " +
            "recipe cards, handwritten recipe cards, and screenshots. Identify only the actual " +
            "recipe content — a title, the ingredient list, and the ordered directions. Ignore " +
            "decorative headings, food photography, advertisements, nutrition panels, unrelated " +
            "captions, publication branding, and surrounding prose that isn't part of the recipe " +
            "itself.\n\n" +
            "You may be given more than one image. When there is more than one, they all belong " +
            "to the same single recipe and are supplied in their intended reading order — for " +
            "example consecutive screenshots of one long recipe page. Treat them as one combined " +
            "source: produce one title, one ordered ingredient list, and one ordered set of " +
            "directions spanning all of them, not a separate recipe per image. Preserve ingredient " +
            "order and step order as they read across the full sequence of images. Keep section " +
            "headings (e.g. 'For the sauce') when they're useful for understanding the structure. " +
            "Consecutive images often overlap — the bottom of one screenshot may repeat the top of " +
            "the next. When you recognize the same ingredient line, step, or heading repeated " +
            "because of that overlap, include it only once at its correct position; do not list it " +
            "twice just because it appeared in two images. Only merge lines you recognize as the " +
            "same repeated content — never merge two genuinely different ingredients or steps just " +
            "because they look similar.\n\n" +
            "Preserve each ingredient line as useful free text exactly as it reads in the photo " +
            "(for example '1 pound ground turkey') — do not split it into quantity/unit/name " +
            "fields, and do not invent units or amounts that aren't shown. Preserve the order of " +
            "the steps. Preserve the meaning of the source rather than rewriting it stylistically " +
            "— do not paraphrase, summarize, or improve the wording. Never invent text that isn't " +
            "legible in any of the images: if part of the recipe is cut off, blurry, or otherwise " +
            "unclear in every image it appears in, return whatever is readable and add a warning " +
            "describing what's missing or unclear instead of guessing at it.\n\n" +
            "Some ingredient lists include a section label that introduces a subgroup of " +
            "ingredients rather than naming an ingredient itself — for example 'Optional " +
            "toppings:', 'Toppings:', 'For serving:', 'For garnish:', 'Garnish:', or 'For the " +
            "sauce:'. Recognize this general pattern (a short phrase, often ending in a colon, " +
            "that describes a role or category rather than a specific purchasable ingredient) " +
            "wherever it appears, not just these exact examples, and omit the heading itself from " +
            "the ingredients list. Still include every actual ingredient line beneath that " +
            "heading, in order, exactly as you would any other ingredient — only the structural " +
            "heading itself is omitted, never the ingredient lines it introduces, and do not " +
            "otherwise simplify or drop descriptive wording from real ingredient lines.\n\n" +
            "The photo may include handwritten additions or corrections. Only incorporate a " +
            "handwritten change into the ingredient or step text when it is clearly legible and " +
            "clearly modifies a specific ingredient or step — for example an ingredient clearly " +
            "appended to the list, a quantity that's crossed out and replaced, or a note clearly " +
            "tied to one numbered step. Whenever you incorporate a handwritten change, add a " +
            "warning saying handwritten content was incorporated so the user knows to double-check " +
            "it. If handwriting is present but ambiguous, general, or not clearly tied to a " +
            "specific line, leave the printed text unchanged and add a warning instead — for " +
            "example 'Handwritten text was detected near the ingredients; please review the " +
            "image.' Do not guess at unclear handwriting, and do not report a confidence score.\n\n" +
            "If none of the images contain a recognizable recipe, return a null title and empty " +
            "ingredients and steps arrays.\n\n" +
            "If a servings count or yield is clearly printed (for example '4 servings', 'Serves 6', " +
            "'Makes 12 muffins'), put it in the servings field exactly as written. Leave servings " +
            "null if it isn't stated or isn't clearly legible — never guess or estimate one.\n\n" +
            "If prep time, cook time, and/or total time are clearly printed (for example 'Prep: 20 " +
            "min', 'Cook Time: 40 minutes', 'Ready in 1 hr 30 min'), convert each to a whole number " +
            "of minutes and put it in the matching field (prepTimeMinutes, cookTimeMinutes, " +
            "totalTimeMinutes). Only fill in a field when its value is directly stated in the " +
            "image — never calculate or estimate one from another (do not compute total from prep " +
            "+ cook, and do not split a total into prep/cook). If the recipe shows only one overall " +
            "duration that isn't labeled as specifically prep or cook (for example just 'Total " +
            "Time: 45 min', or a single unlabeled duration near the title), treat it as " +
            "totalTimeMinutes rather than guessing it's prep or cook. If the source gives prep and " +
            "cook separately, preserve that distinction instead of merging them. Leave a time field " +
            "null if it isn't clearly stated or isn't legible.",
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                dataUrls.length === 1
                  ? "Extract the recipe from this photo."
                  : `Extract the recipe from these ${dataUrls.length} photos, given in reading order. ` +
                    "They are all of the same recipe.",
            },
            ...dataUrls.flatMap((dataUrl, index) => [
              ...(dataUrls.length > 1
                ? [{ type: "input_text" as const, text: `Image ${index + 1} of ${dataUrls.length}:` }]
                : []),
              { type: "input_image" as const, image_url: dataUrl, detail: "high" as const },
            ]),
          ],
        },
      ],
      // Photos never carry a source-page image to extract — null, same as
      // the URL importer leaves it null when the source page has none.
      null
    );
  } catch (err) {
    console.error("OpenAI recipe import failed:", err);
    return NextResponse.json(
      { error: files.length === 1 ? "Couldn't read that photo right now. Try again." : "Couldn't read those photos right now. Try again." },
      { status: 502 }
    );
  }

  return NextResponse.json(draft);
}

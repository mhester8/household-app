import { supabase } from "@/lib/supabase/client";

export type Recipe = {
  id: string;
  title: string;
  source_url: string | null;
  notes: string | null;
  servings: string | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  total_time_minutes: number | null;
  image_url: string | null;
  // The Pinterest Pin the recipe was discovered/imported through — distinct
  // from source_url, which is the recipe website itself. Null for manual
  // recipes and normal (non-Pinterest) URL imports. Optional (not just
  // nullable) because the recipes list query deliberately doesn't select
  // it — only the detail page, which actually displays it, does.
  pinterest_pin_url?: string | null;
  created_at: string;
};

export type RecipeIngredient = {
  id: string;
  recipe_id: string;
  position: number;
  text: string;
};

export type RecipeStep = {
  id: string;
  recipe_id: string;
  position: number;
  text: string;
};

// Which import pipeline produced a recipe_originals snapshot. A Pin with a
// destination link is handed to the URL importer, so it's still "pinterest"
// even though it runs through the same code path as a plain URL import —
// callers pass this explicitly rather than it being inferred from the URL.
export type RecipeOriginalSourceType = "url" | "photo" | "pinterest";

// The immutable snapshot of what was accepted at the first import-review
// save, before any later household editing. Never written to again after
// insert. Absent (no row) for manual recipes and for recipes saved before
// this feature existed — both are treated the same by callers: no original
// to show.
export type RecipeOriginal = {
  recipe_id: string;
  source_type: RecipeOriginalSourceType;
  captured_at: string;
  title: string;
  servings: string | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  total_time_minutes: number | null;
  source_url: string | null;
  pinterest_pin_url: string | null;
  image_url: string | null;
  ingredients: string[];
  steps: string[];
};

export function sortByPosition<T extends { position: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.position - b.position);
}

export function sortRecipesByCreatedAt<T extends { created_at: string }>(recipes: T[]): T[] {
  return [...recipes].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

// Shared by recipe_ingredients and recipe_steps Realtime handlers on the
// detail page: inserts a new row or replaces an existing one with the same
// id, then re-sorts by display order — same shape as groceries' upsertItem.
export function upsertLine<T extends { id: string; position: number }>(
  current: T[],
  row: T
): T[] {
  const exists = current.some((existing) => existing.id === row.id);
  const next = exists
    ? current.map((existing) => (existing.id === row.id ? row : existing))
    : [...current, row];
  return sortByPosition(next);
}

export function removeLineById<T extends { id: string }>(current: T[], id: string): T[] {
  return current.filter((existing) => existing.id !== id);
}

export type RecipeSaveInput = {
  title: string;
  sourceUrl: string | null;
  notes: string | null;
  servings: string | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  totalTimeMinutes: number | null;
  ingredients: string[];
  steps: string[];
  // Omitted by the manual create/edit forms, which have no image field yet
  // (Phase 2). Only the URL importer's save step sets this, from the
  // draft's JSON-LD-derived image. `createRecipe` treats "omitted" the
  // same as null.
  imageUrl?: string | null;
  // Set only when the URL importer was reached via a Pinterest Pin (see
  // /recipes/import-url's ?pinterestPinUrl= handling). Omitted by every
  // other save path.
  pinterestPinUrl?: string | null;
};

// Shape returned by POST /api/import-recipe and /api/import-recipe-url — a
// review-only draft, not yet saved. `warnings` is for the review UI only
// and is never persisted. `sourceUrl` is only set by the URL importer (the
// final URL actually fetched, after redirects) so the review form can
// prefill the existing Source URL field; the photo importer leaves it
// undefined. `servings` preserves the source's stated yield wording (e.g.
// "Serves 6") rather than forcing it into a number — null when absent or
// not confidently readable. `prepTimeMinutes`/`cookTimeMinutes`/
// `totalTimeMinutes` are only ever set from a value the source actually
// stated; importers never calculate one from the others.
export type RecipeImportDraft = {
  title: string | null;
  ingredients: string[];
  steps: string[];
  warnings: string[];
  sourceUrl?: string;
  servings: string | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  totalTimeMinutes: number | null;
  // The source page's JSON-LD image, if any — set only by the URL importer.
  // Photo imports never set this (no source page to read one from); the
  // photo importer leaves it null same as an absent JSON-LD image would.
  imageUrl: string | null;
};

async function insertChildren(recipeId: string, input: RecipeSaveInput): Promise<string | null> {
  if (input.ingredients.length > 0) {
    const { error } = await supabase.from("recipe_ingredients").insert(
      input.ingredients.map((text, index) => ({ recipe_id: recipeId, position: index, text }))
    );
    if (error) {
      return error.message;
    }
  }

  if (input.steps.length > 0) {
    const { error } = await supabase.from("recipe_steps").insert(
      input.steps.map((text, index) => ({ recipe_id: recipeId, position: index, text }))
    );
    if (error) {
      return error.message;
    }
  }

  return null;
}

// Shared by /recipes/new and the photo importer's review step — both create
// a recipe row plus its ingredient/step children, and roll back the recipe
// row if the children insert fails so a partial recipe never sticks around.
//
// originalSourceType is passed only by the three import review flows
// (URL/photo/Pinterest) — manual creation omits it, so manual recipes never
// get a recipe_originals row. When set, the snapshot is captured from this
// exact same `input` (the values the household just accepted in review), not
// from anything raw/pre-review — see decision on recipe_originals.
export async function createRecipe(
  input: RecipeSaveInput,
  originalSourceType?: RecipeOriginalSourceType
): Promise<{ id: string; error: null } | { id: null; error: string }> {
  const { data: recipe, error: recipeError } = await supabase
    .from("recipes")
    .insert({
      title: input.title,
      source_url: input.sourceUrl,
      notes: input.notes,
      servings: input.servings,
      prep_time_minutes: input.prepTimeMinutes,
      cook_time_minutes: input.cookTimeMinutes,
      total_time_minutes: input.totalTimeMinutes,
      image_url: input.imageUrl ?? null,
      // Only referenced when actually set, so a normal manual/URL-import
      // save (the vast majority of writes) never touches this column —
      // only a Pinterest-originated save requires the pinterest_pin_url
      // column to already exist.
      ...(input.pinterestPinUrl ? { pinterest_pin_url: input.pinterestPinUrl } : {}),
    })
    .select("id")
    .single();

  if (recipeError || !recipe) {
    return { id: null, error: `Couldn't save recipe: ${recipeError?.message ?? "unknown error"}` };
  }

  const childrenError = await insertChildren(recipe.id, input);

  if (childrenError) {
    await supabase.from("recipes").delete().eq("id", recipe.id);
    return { id: null, error: `Couldn't save recipe: ${childrenError}` };
  }

  if (originalSourceType) {
    // Best-effort, deliberately not rolled back on failure: the household
    // recipe above is the primary artifact and already saved successfully —
    // the household did real work (importing, reviewing) to get here. If
    // this insert fails, the recipe is simply left without a preserved
    // original, the same graceful state as a manual recipe or one saved
    // before this feature existed (View original just isn't offered).
    // Losing that provenance isn't worth discarding the recipe over, and
    // this table is never written to again after this call, so there's no
    // later chance to retry it transparently.
    const { error: originalError } = await supabase.from("recipe_originals").insert({
      recipe_id: recipe.id,
      source_type: originalSourceType,
      title: input.title,
      servings: input.servings,
      prep_time_minutes: input.prepTimeMinutes,
      cook_time_minutes: input.cookTimeMinutes,
      total_time_minutes: input.totalTimeMinutes,
      source_url: input.sourceUrl,
      pinterest_pin_url: input.pinterestPinUrl ?? null,
      image_url: input.imageUrl ?? null,
      ingredients: input.ingredients,
      steps: input.steps,
    });

    if (originalError) {
      console.error("Couldn't save recipe_originals snapshot:", originalError.message);
    }
  }

  return { id: recipe.id, error: null };
}

// Returns null both when no snapshot exists (manual recipe, legacy recipe
// predating this feature, or a snapshot insert that failed) and on a read
// error — callers treat "no original to show" as the only outcome that
// matters, never distinguishing why.
export async function getRecipeOriginal(recipeId: string): Promise<RecipeOriginal | null> {
  const { data, error } = await supabase
    .from("recipe_originals")
    .select(
      "recipe_id, source_type, captured_at, title, servings, prep_time_minutes, cook_time_minutes, total_time_minutes, source_url, pinterest_pin_url, image_url, ingredients, steps"
    )
    .eq("recipe_id", recipeId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as RecipeOriginal;
}

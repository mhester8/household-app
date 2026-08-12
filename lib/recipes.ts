import { supabase } from "@/lib/supabase/client";

export type Recipe = {
  id: string;
  title: string;
  source_url: string | null;
  notes: string | null;
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
  ingredients: string[];
  steps: string[];
};

// Shape returned by POST /api/import-recipe — a review-only draft, not yet
// saved. `warnings` is for the review UI only and is never persisted.
export type RecipeImportDraft = {
  title: string | null;
  ingredients: string[];
  steps: string[];
  warnings: string[];
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
export async function createRecipe(
  input: RecipeSaveInput
): Promise<{ id: string; error: null } | { id: null; error: string }> {
  const { data: recipe, error: recipeError } = await supabase
    .from("recipes")
    .insert({ title: input.title, source_url: input.sourceUrl, notes: input.notes })
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

  return { id: recipe.id, error: null };
}

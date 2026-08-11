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

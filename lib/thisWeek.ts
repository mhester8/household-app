// `desired_servings` is how much of the recipe this queued occasion is
// actually making — separate from the saved recipe's own `servings`, which
// always describes the original stored ingredient quantities and is never
// modified by this. Null means "no override," i.e. use the recipe's
// original yield (equivalent to a 1:1 scale factor).
export type ThisWeekRecipe = {
  id: string;
  recipe_id: string;
  added_at: string;
  desired_servings: number | null;
};

export function sortByAddedAt<T extends { added_at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => new Date(a.added_at).getTime() - new Date(b.added_at).getTime());
}

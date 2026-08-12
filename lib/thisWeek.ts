export type ThisWeekRecipe = {
  id: string;
  recipe_id: string;
  added_at: string;
};

export function sortByAddedAt<T extends { added_at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => new Date(a.added_at).getTime() - new Date(b.added_at).getTime());
}

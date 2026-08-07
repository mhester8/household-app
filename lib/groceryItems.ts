export type GroceryItem = {
  id: string;
  name: string;
  completed: boolean;
  created_at: string;
};

export function sortByCreatedAt(items: GroceryItem[]) {
  return [...items].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

// Inserts a new row or replaces an existing one with the same id, then re-sorts.
// Shared by local mutations and incoming Realtime events so a write and the
// Realtime echo of that same write never produce a duplicate row.
export function upsertItem(currentItems: GroceryItem[], item: GroceryItem) {
  const exists = currentItems.some((existing) => existing.id === item.id);
  const nextItems = exists
    ? currentItems.map((existing) => (existing.id === item.id ? item : existing))
    : [...currentItems, item];
  return sortByCreatedAt(nextItems);
}

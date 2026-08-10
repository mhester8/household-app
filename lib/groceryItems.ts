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

// Normalizes a name for duplicate/suggestion matching only (never for display):
// trims, collapses internal whitespace, lowercases, and strips one trailing
// "s" so obvious plurals match (e.g. "banana" / "Bananas"). Deliberately
// conservative — it will not merge things like "milk" and "whole milk".
export function normalizeItemName(name: string) {
  const collapsed = name.trim().toLowerCase().replace(/\s+/g, " ");
  return collapsed.length > 3 && collapsed.endsWith("s")
    ? collapsed.slice(0, -1)
    : collapsed;
}

// Finds an existing active (not completed) item that a new/edited name would
// duplicate, so callers can block the insert instead of adding a second row.
export function findActiveDuplicate(
  items: GroceryItem[],
  name: string,
  excludeId?: string
) {
  const target = normalizeItemName(name);
  if (target === "") {
    return undefined;
  }
  return items.find(
    (item) =>
      item.id !== excludeId &&
      !item.completed &&
      normalizeItemName(item.name) === target
  );
}

export type GrocerySuggestion = {
  name: string;
  count: number;
  lastUsedAt: string;
};

// Ranks household-history suggestions for the given query: prefix/text
// relevance first, then how often the household has bought it, then how
// recently. Items already active (not completed) are suppressed since
// they're already on the list. Purely local/deterministic — no AI involved.
export function getGrocerySuggestions(
  items: GroceryItem[],
  query: string,
  activeExcludeNames: Set<string> = new Set(),
  limit = 5
): GrocerySuggestion[] {
  const normalizedQuery = normalizeItemName(query);
  if (normalizedQuery === "") {
    return [];
  }

  const byNormalizedName = new Map<
    string,
    { name: string; count: number; lastUsedAt: string }
  >();

  for (const item of items) {
    const key = normalizeItemName(item.name);
    if (key === "" || activeExcludeNames.has(key)) {
      continue;
    }
    const existing = byNormalizedName.get(key);
    if (!existing) {
      byNormalizedName.set(key, { name: item.name, count: 1, lastUsedAt: item.created_at });
      continue;
    }
    existing.count += 1;
    if (item.created_at > existing.lastUsedAt) {
      existing.lastUsedAt = item.created_at;
      existing.name = item.name;
    }
  }

  const matches = Array.from(byNormalizedName.entries())
    .filter(([key]) => key.includes(normalizedQuery))
    .map(([key, value]) => ({ ...value, isPrefixMatch: key.startsWith(normalizedQuery) }));

  matches.sort((a, b) => {
    if (a.isPrefixMatch !== b.isPrefixMatch) {
      return a.isPrefixMatch ? -1 : 1;
    }
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    return b.lastUsedAt.localeCompare(a.lastUsedAt);
  });

  return matches.slice(0, limit).map(({ name, count, lastUsedAt }) => ({
    name,
    count,
    lastUsedAt,
  }));
}

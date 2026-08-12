"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import { findActiveDuplicate, insertGroceryItems, type GroceryItem } from "@/lib/groceryItems";
import type { ToastState } from "@/components/Toast";

const SUCCESS_TOAST_MS = 4000;
const ERROR_TOAST_MS = 6000;
const INFO_TOAST_MS = 3000;

export type IngredientReviewLine = {
  id: string;
  text: string;
  // Recipe title, when reviewing ingredients pooled from more than one
  // recipe (This Week). Left undefined for a single-recipe review, which
  // renders as one flat list with no group headers.
  groupLabel?: string;
};

// Groups consecutive lines sharing the same groupLabel, preserving the order
// the caller passed in — callers control ordering (recipe order, then
// ingredient position within each recipe), this just clusters for display.
function groupLines(lines: IngredientReviewLine[]) {
  const groups: { label: string | null; lines: IngredientReviewLine[] }[] = [];
  for (const line of lines) {
    const label = line.groupLabel ?? null;
    const current = groups[groups.length - 1];
    if (current && current.label === label) {
      current.lines.push(line);
    } else {
      groups.push({ label, lines: [line] });
    }
  }
  return groups;
}

// Shared by the single-recipe "Add to shopping list" flow and the This Week
// combined flow: recipe ingredient rows -> selectable review -> duplicate
// check -> bulk grocery insert. `lines` is read once on mount (like
// RecipeForm's initialX props) — callers remount this by conditionally
// rendering it, so a fresh open always starts from a clean state.
export function IngredientReviewPanel({
  lines,
  onCancel,
  onAdded,
  onToast,
}: {
  lines: IngredientReviewLine[];
  onCancel: () => void;
  onAdded: (addedCount: number) => void;
  onToast: (toast: ToastState, durationMs: number) => void;
}) {
  const [activeGroceryItems, setActiveGroceryItems] = useState<GroceryItem[] | null>(null);
  const [isLoadingActiveItems, setIsLoadingActiveItems] = useState(true);
  const [loadActiveItemsError, setLoadActiveItemsError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoadingActiveItems(true);
      setLoadActiveItemsError(null);

      const { data, error } = await supabase
        .from("grocery_items")
        .select("id, name, completed, created_at")
        .eq("completed", false);

      if (cancelled) {
        return;
      }

      // If the duplicate check itself fails, don't block the flow on it —
      // fall back to treating nothing as a known duplicate so every
      // ingredient stays selectable.
      const active = error || !data ? [] : data;
      if (error) {
        setLoadActiveItemsError(error.message);
      }

      setActiveGroceryItems(active);
      setSelectedIds(
        new Set(lines.filter((line) => !findActiveDuplicate(active, line.text)).map((line) => line.id))
      );
      setIsLoadingActiveItems(false);
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleSubmit() {
    const selected = lines.filter((line) => selectedIds.has(line.id));
    if (selected.length === 0) {
      return;
    }

    setIsSubmitting(true);

    // Another device could have added one of these since the panel opened —
    // re-check right before inserting and quietly drop anything that's now
    // a duplicate. A failure here must abort instead of falling back to the
    // stale selection: inserting without a successful recheck could create
    // a duplicate the user can no longer see was ever a risk.
    const { data: freshActive, error: freshActiveError } = await supabase
      .from("grocery_items")
      .select("id, name, completed, created_at")
      .eq("completed", false);

    if (freshActiveError || !freshActive) {
      setIsSubmitting(false);
      onToast(
        {
          message: "Couldn't verify the shopping list. Try again.",
          actionLabel: "Retry",
          onAction: () => handleSubmit(),
          tone: "danger",
        },
        ERROR_TOAST_MS
      );
      return;
    }

    const toInsert = selected.filter((line) => !findActiveDuplicate(freshActive, line.text));
    const skippedCount = selected.length - toInsert.length;

    if (toInsert.length === 0) {
      setIsSubmitting(false);
      onToast({ message: "Those items are already on the shopping list" }, INFO_TOAST_MS);
      onAdded(0);
      return;
    }

    try {
      await insertGroceryItems(toInsert.map((line) => ({ id: crypto.randomUUID(), name: line.text })));
      setIsSubmitting(false);
      const itemWord = toInsert.length === 1 ? "item" : "items";
      onToast(
        {
          message:
            skippedCount > 0
              ? `Added ${toInsert.length} ${itemWord} (${skippedCount} already on the list)`
              : `Added ${toInsert.length} ${itemWord} to the shopping list`,
        },
        SUCCESS_TOAST_MS
      );
      onAdded(toInsert.length);
    } catch {
      setIsSubmitting(false);
      onToast(
        {
          message: "Couldn't add items to the shopping list",
          actionLabel: "Retry",
          onAction: () => handleSubmit(),
          tone: "danger",
        },
        ERROR_TOAST_MS
      );
    }
  }

  const duplicateIds = activeGroceryItems
    ? new Set(lines.filter((line) => findActiveDuplicate(activeGroceryItems, line.text)).map((line) => line.id))
    : new Set<string>();
  const selectableCount = lines.length - duplicateIds.size;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
      <span className="text-sm font-semibold text-foreground">Add ingredients to the shopping list</span>

      {loadActiveItemsError && (
        <p className="text-xs text-muted-foreground">
          Couldn&rsquo;t check your shopping list for duplicates ({loadActiveItemsError}). Showing all
          ingredients as selectable.
        </p>
      )}

      {isLoadingActiveItems || activeGroceryItems === null ? (
        <p className="text-sm text-muted-foreground">Checking your shopping list...</p>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {groupLines(lines).map((group, index) => (
              <div key={group.label ?? `ungrouped-${index}`} className="flex flex-col gap-1">
                {group.label && (
                  <span className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </span>
                )}
                <ul className="flex flex-col gap-1">
                  {group.lines.map((line) => {
                    const isDuplicate = duplicateIds.has(line.id);
                    const isChecked = selectedIds.has(line.id);
                    return (
                      <li key={line.id}>
                        <label
                          className={`flex min-h-11 items-center gap-2.5 rounded-lg px-1.5 py-1 text-[15px] ${
                            isDuplicate ? "text-muted-foreground" : "text-foreground"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={isDuplicate}
                            onChange={() => toggle(line.id)}
                            className="h-5 w-5 shrink-0 rounded border-border/80 text-primary focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                          />
                          <span className="min-w-0 flex-1 break-words">{line.text}</span>
                          {isDuplicate && (
                            <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                              Already on list
                            </span>
                          )}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          {selectableCount === 0 && (
            <p className="text-sm text-muted-foreground">All ingredients are already on the shopping list.</p>
          )}
        </>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="min-h-11 flex-1 rounded-xl bg-surface-muted px-4 text-sm font-semibold text-foreground transition hover:bg-border disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting || isLoadingActiveItems || selectedIds.size === 0}
          className="min-h-11 flex-1 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
        >
          {isSubmitting ? "Adding..." : `Add ${selectedIds.size} item${selectedIds.size === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}

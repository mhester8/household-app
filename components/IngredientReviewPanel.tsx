"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import { findActiveDuplicate, insertGroceryItems, type GroceryItem } from "@/lib/groceryItems";
import {
  addPantryBasic,
  fetchPantryBasics,
  matchesPantryBasic,
  removePantryBasic,
  type PantryBasic,
} from "@/lib/pantryBasics";
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

// "Salt, pepper + 3 more" — first couple of names, then a count of the rest.
function formatPantryBasicsSummary(basics: PantryBasic[]): string {
  if (basics.length === 0) {
    return "No pantry basics yet";
  }
  const names = basics.map((basic) => basic.name.charAt(0).toUpperCase() + basic.name.slice(1));
  if (names.length <= 2) {
    return names.join(", ");
  }
  return `${names.slice(0, 2).join(", ")} + ${names.length - 2} more`;
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

  const [pantryBasics, setPantryBasics] = useState<PantryBasic[]>([]);
  const [excludePantryBasics, setExcludePantryBasics] = useState(false);
  const [isEditingPantryBasics, setIsEditingPantryBasics] = useState(false);
  const [newPantryTermText, setNewPantryTermText] = useState("");
  const [pantryEditError, setPantryEditError] = useState<string | null>(null);
  const [isSavingPantryEdit, setIsSavingPantryEdit] = useState(false);

  // Duplicates are fixed for the life of one panel session (computed from
  // the load below, not re-derived as the user checks/unchecks things), so
  // the pantry toggle/editor and the checkbox list all read from the same set.
  const duplicateIds = activeGroceryItems
    ? new Set(lines.filter((line) => findActiveDuplicate(activeGroceryItems, line.text)).map((line) => line.id))
    : new Set<string>();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoadingActiveItems(true);
      setLoadActiveItemsError(null);

      const [groceryResult, pantryResult] = await Promise.all([
        supabase.from("grocery_items").select("id, name, completed, created_at").eq("completed", false),
        fetchPantryBasics(),
      ]);

      if (cancelled) {
        return;
      }

      // If the duplicate check itself fails, don't block the flow on it —
      // fall back to treating nothing as a known duplicate so every
      // ingredient stays selectable. Same treatment for a failed pantry
      // basics load: the toggle just has nothing to exclude yet.
      const active = groceryResult.error || !groceryResult.data ? [] : groceryResult.data;
      if (groceryResult.error) {
        setLoadActiveItemsError(groceryResult.error.message);
      }

      setActiveGroceryItems(active);
      setPantryBasics(pantryResult.basics);
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

  // Shared by the toggle and the inline editor: applies one direction
  // ("exclude" unchecks, "include" re-checks) to whichever lines pass
  // matchTest, skipping active duplicates (those stay disabled/unchecked
  // regardless) and never touching any other line's selection. This keeps
  // every pantry-related action — toggling, adding a term, removing a term —
  // a plain, predictable re-application of "does this line match", rather
  // than a filter that tries to remember manual overrides.
  function applyPantryLineRule(
    matchTest: (line: IngredientReviewLine) => boolean,
    action: "exclude" | "include"
  ) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const line of lines) {
        if (duplicateIds.has(line.id) || !matchTest(line)) {
          continue;
        }
        if (action === "exclude") {
          next.delete(line.id);
        } else {
          next.add(line.id);
        }
      }
      return next;
    });
  }

  function handleTogglePantryBasics() {
    const nextExcluding = !excludePantryBasics;
    setExcludePantryBasics(nextExcluding);
    applyPantryLineRule(
      (line) => matchesPantryBasic(line.text, pantryBasics),
      nextExcluding ? "exclude" : "include"
    );
  }

  async function handleAddPantryTerm(event: React.FormEvent) {
    event.preventDefault();
    if (newPantryTermText.trim() === "") {
      return;
    }

    setIsSavingPantryEdit(true);
    setPantryEditError(null);

    const { basic, error } = await addPantryBasic(newPantryTermText);

    if (error || !basic) {
      setPantryEditError(error ?? "Couldn't add that pantry basic. Try again.");
      setIsSavingPantryEdit(false);
      return;
    }

    setPantryBasics((current) => [...current, basic]);
    setNewPantryTermText("");
    setIsSavingPantryEdit(false);

    // Only reach into the current selection if the toggle is actively
    // excluding — while it's off, pantry status doesn't affect anything.
    if (excludePantryBasics) {
      applyPantryLineRule((line) => matchesPantryBasic(line.text, [basic]), "exclude");
    }
  }

  async function handleRemovePantryTerm(id: string) {
    setIsSavingPantryEdit(true);
    setPantryEditError(null);

    const { error } = await removePantryBasic(id);

    if (error) {
      setPantryEditError("Couldn't remove that pantry basic. Try again.");
      setIsSavingPantryEdit(false);
      return;
    }

    const removedBasic = pantryBasics.find((basic) => basic.id === id);
    const remainingBasics = pantryBasics.filter((basic) => basic.id !== id);
    setPantryBasics(remainingBasics);
    setIsSavingPantryEdit(false);

    if (excludePantryBasics && removedBasic) {
      // Re-check a line only if it matched the removed term AND doesn't
      // still match some other remaining term (unlikely with this small a
      // list, but cheap to get right).
      applyPantryLineRule(
        (line) =>
          matchesPantryBasic(line.text, [removedBasic]) && !matchesPantryBasic(line.text, remainingBasics),
        "include"
      );
    }
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
          <div className="flex flex-col gap-1.5 rounded-xl bg-surface-muted px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">Exclude pantry basics</span>
              <button
                type="button"
                role="switch"
                aria-checked={excludePantryBasics}
                aria-label="Exclude pantry basics"
                onClick={handleTogglePantryBasics}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-surface-muted ${
                  excludePantryBasics ? "bg-primary" : "bg-border"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`inline-block h-5 w-5 transform rounded-full bg-surface shadow transition ${
                    excludePantryBasics ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{formatPantryBasicsSummary(pantryBasics)}</span>
              <button
                type="button"
                onClick={() => setIsEditingPantryBasics((open) => !open)}
                className="shrink-0 text-xs font-semibold text-primary"
              >
                {isEditingPantryBasics ? "Done" : "Edit"}
              </button>
            </div>

            {isEditingPantryBasics && (
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-2.5 py-2">
                {pantryEditError && <p className="text-xs text-danger">{pantryEditError}</p>}

                <ul className="flex flex-col gap-1">
                  {pantryBasics.map((basic) => (
                    <li key={basic.id} className="flex items-center justify-between gap-2 text-sm text-foreground">
                      <span className="capitalize">{basic.name}</span>
                      <button
                        type="button"
                        onClick={() => handleRemovePantryTerm(basic.id)}
                        disabled={isSavingPantryEdit}
                        aria-label={`Remove ${basic.name} from pantry basics`}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-lg text-muted-foreground transition hover:bg-surface-muted hover:text-danger disabled:opacity-50"
                      >
                        &times;
                      </button>
                    </li>
                  ))}
                  {pantryBasics.length === 0 && (
                    <li className="text-xs text-muted-foreground">No pantry basics yet.</li>
                  )}
                </ul>

                <form onSubmit={handleAddPantryTerm} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newPantryTermText}
                    onChange={(event) => setNewPantryTermText(event.target.value)}
                    placeholder="Add a pantry basic"
                    aria-label="New pantry basic"
                    autoComplete="off"
                    disabled={isSavingPantryEdit}
                    className="min-h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface-muted px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={isSavingPantryEdit || newPantryTermText.trim() === ""}
                    className="min-h-9 shrink-0 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
                  >
                    Add
                  </button>
                </form>
              </div>
            )}
          </div>

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

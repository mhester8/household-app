"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { sortByPosition } from "@/lib/recipes";
import { sortByAddedAt, type ThisWeekRecipe } from "@/lib/thisWeek";
import { computeScaleFactor, parseNumericServings, scaleIngredientLine } from "@/lib/recipeServings";
import { IngredientReviewPanel, type IngredientReviewLine } from "@/components/IngredientReviewPanel";
import { Toast, type ToastState } from "@/components/Toast";
import { REALTIME_UNAVAILABLE_MESSAGE, useRealtimeSubscription } from "@/lib/useRealtimeSubscription";

const ERROR_TOAST_MS = 6000;

type QueuedRecipe = ThisWeekRecipe & { title: string; servings: string | null };

export default function ThisWeekPage() {
  const [queue, setQueue] = useState<QueuedRecipe[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [isLoadingReviewLines, setIsLoadingReviewLines] = useState(false);
  const [reviewLines, setReviewLines] = useState<IngredientReviewLine[]>([]);

  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  // In-progress edits to the "Making: N servings" input, keyed by This Week
  // entry id — separate from the persisted `desired_servings` so typing
  // doesn't write on every keystroke. Same draft-state split RecipeForm uses
  // for its hour/minute time inputs. An entry is only present here while
  // being actively edited; it's removed once the edit commits (or is a
  // no-op), after which display falls back to the persisted/derived value.
  const [desiredServingsDrafts, setDesiredServingsDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    async function loadQueue() {
      setIsLoading(true);
      setErrorMessage(null);

      const { data: rows, error: rowsError } = await supabase
        .from("this_week_recipes")
        .select("id, recipe_id, added_at, desired_servings")
        .order("added_at", { ascending: true });

      if (rowsError) {
        setErrorMessage(`Could not load This Week: ${rowsError.message}`);
        setIsLoading(false);
        return;
      }

      const recipeIds = (rows ?? []).map((row) => row.recipe_id);
      if (recipeIds.length === 0) {
        setQueue([]);
        setIsLoading(false);
        return;
      }

      const { data: recipesData, error: recipesError } = await supabase
        .from("recipes")
        .select("id, title, servings")
        .in("id", recipeIds);

      if (recipesError) {
        setErrorMessage(`Could not load This Week: ${recipesError.message}`);
        setIsLoading(false);
        return;
      }

      const titleByRecipeId = new Map((recipesData ?? []).map((recipe) => [recipe.id, recipe.title]));
      const servingsByRecipeId = new Map((recipesData ?? []).map((recipe) => [recipe.id, recipe.servings]));
      setQueue(
        (rows ?? []).map((row) => ({
          ...row,
          title: titleByRecipeId.get(row.recipe_id) ?? "Untitled recipe",
          servings: servingsByRecipeId.get(row.recipe_id) ?? null,
        }))
      );
      setIsLoading(false);
    }

    loadQueue();
  }, []);

  // Smallest Realtime setup for a shared queue: watch inserts/deletes, plus
  // updates now that `desired_servings` can be edited in place. An INSERT
  // payload only carries the this_week_recipes row, so a follow-up query
  // fetches the recipe's title/servings before it's added to the list —
  // same shape as the recipes list page's own INSERT handler.
  useRealtimeSubscription({
    channelName: "this_week_changes",
    deps: [],
    build: (channel) =>
      channel
        .on<ThisWeekRecipe>(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "this_week_recipes" },
          async (payload) => {
            const row = payload.new as ThisWeekRecipe;
            const { data: recipeRow } = await supabase
              .from("recipes")
              .select("title, servings")
              .eq("id", row.recipe_id)
              .maybeSingle();

            setQueue((current) => {
              if (current.some((entry) => entry.id === row.id)) {
                return current;
              }
              return sortByAddedAt([
                ...current,
                { ...row, title: recipeRow?.title ?? "Untitled recipe", servings: recipeRow?.servings ?? null },
              ]);
            });
          }
        )
        .on<ThisWeekRecipe>(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "this_week_recipes" },
          (payload) => {
            const updated = payload.new as ThisWeekRecipe;
            setQueue((current) =>
              current.map((entry) =>
                entry.id === updated.id ? { ...entry, desired_servings: updated.desired_servings } : entry
              )
            );
          }
        )
        .on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "this_week_recipes" },
          (payload) => {
            const deletedId = (payload.old as { id: string }).id;
            setQueue((current) => current.filter((entry) => entry.id !== deletedId));
          }
        ),
    onUnavailable: () => setErrorMessage(REALTIME_UNAVAILABLE_MESSAGE),
    onRecovered: () =>
      setErrorMessage((current) => (current === REALTIME_UNAVAILABLE_MESSAGE ? null : current)),
  });

  function showToast(next: ToastState, durationMs: number) {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToast(next);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, durationMs);
  }

  function dismissToast() {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast(null);
  }

  async function handleRemove(entry: QueuedRecipe) {
    setQueue((current) => current.filter((existing) => existing.id !== entry.id));

    const { error } = await supabase.from("this_week_recipes").delete().eq("id", entry.id);

    if (error) {
      setQueue((current) => sortByAddedAt([...current, entry]));
      showToast(
        {
          message: `Couldn't remove ${entry.title}`,
          actionLabel: "Retry",
          onAction: () => handleRemove(entry),
          tone: "danger",
        },
        ERROR_TOAST_MS
      );
    }
  }

  // Same optimistic-then-rollback shape as handleRemove, just scoped to
  // every currently-queued entry (deletes by id, like the per-row remove,
  // rather than an unconditional table delete) instead of one.
  async function handleClearThisWeek() {
    setIsClearing(true);
    const snapshot = queue;
    setQueue([]);

    const { error } = await supabase
      .from("this_week_recipes")
      .delete()
      .in("id", snapshot.map((entry) => entry.id));

    setIsClearing(false);

    if (error) {
      setQueue(sortByAddedAt(snapshot));
      showToast(
        {
          message: "Couldn't clear This Week",
          actionLabel: "Retry",
          onAction: () => handleClearThisWeek(),
          tone: "danger",
        },
        ERROR_TOAST_MS
      );
      return;
    }

    setIsConfirmingClear(false);
  }

  // Controlled value for the "Making: N servings" input: whatever's being
  // actively typed, else the persisted override, else the recipe's own
  // parsed yield (so the field starts pre-filled at the original count
  // without that ever being written to the database).
  function desiredServingsValue(entry: QueuedRecipe, originalServings: number): string {
    return entry.id in desiredServingsDrafts
      ? desiredServingsDrafts[entry.id]
      : String(entry.desired_servings ?? originalServings);
  }

  function handleDesiredServingsChange(entryId: string, value: string) {
    setDesiredServingsDrafts((current) => ({ ...current, [entryId]: value }));
  }

  // Commits the draft on blur: blank or invalid input is treated as "no
  // override" (null — falls back to the recipe's original yield) rather
  // than surfacing a validation error for what's meant to be a lightweight
  // inline control.
  async function commitDesiredServings(entry: QueuedRecipe) {
    const draft = desiredServingsDrafts[entry.id];
    if (draft === undefined) {
      return;
    }

    setDesiredServingsDrafts((current) => {
      const next = { ...current };
      delete next[entry.id];
      return next;
    });

    const parsed = Number(draft.trim());
    const nextValue = draft.trim() !== "" && Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;

    if (nextValue === entry.desired_servings) {
      return;
    }

    const previousValue = entry.desired_servings;
    setQueue((current) =>
      current.map((existing) => (existing.id === entry.id ? { ...existing, desired_servings: nextValue } : existing))
    );

    const { error } = await supabase
      .from("this_week_recipes")
      .update({ desired_servings: nextValue })
      .eq("id", entry.id);

    if (error) {
      setQueue((current) =>
        current.map((existing) =>
          existing.id === entry.id ? { ...existing, desired_servings: previousValue } : existing
        )
      );
      showToast(
        { message: `Couldn't update desired servings for ${entry.title}` },
        ERROR_TOAST_MS
      );
    }
  }

  async function openReview() {
    setIsConfirmingClear(false);
    setIsLoadingReviewLines(true);

    const recipeIds = queue.map((entry) => entry.recipe_id);
    const { data, error } = await supabase
      .from("recipe_ingredients")
      .select("id, recipe_id, position, text")
      .in("recipe_id", recipeIds);

    if (error || !data) {
      showToast({ message: "Couldn't load ingredients" }, ERROR_TOAST_MS);
      setIsLoadingReviewLines(false);
      return;
    }

    // Group by queue order (added_at), then by each recipe's own ingredient
    // order — deterministic regardless of the order rows come back from the
    // database. Scaling is applied per recipe (never touching the stored
    // recipe_ingredients rows) only when both the recipe's original yield
    // and this occasion's desired servings are confidently known and
    // actually differ; otherwise every line for that recipe passes through
    // unchanged, exactly as today.
    const lines: IngredientReviewLine[] = queue.flatMap((entry) => {
      const originalServings = parseNumericServings(entry.servings);
      const scaleFactor = computeScaleFactor(originalServings, entry.desired_servings);
      let groupNote: string | undefined;
      if (scaleFactor !== null && originalServings !== null && entry.desired_servings !== null) {
        groupNote = `Scaled from ${originalServings} to ${entry.desired_servings} servings. Review quantities before adding.`;
      }

      return sortByPosition(data.filter((ingredient) => ingredient.recipe_id === entry.recipe_id)).map(
        (ingredient, index) => {
          const scaledText = scaleFactor !== null ? scaleIngredientLine(ingredient.text, scaleFactor) : null;
          return {
            id: ingredient.id,
            text: scaledText ?? ingredient.text,
            groupLabel: entry.title,
            groupNote: index === 0 ? groupNote : undefined,
            originalText: scaledText !== null ? ingredient.text : undefined,
          };
        }
      );
    });

    setReviewLines(lines);
    setIsLoadingReviewLines(false);
    setIsReviewOpen(true);
  }

  return (
    <div className="flex flex-col gap-2 sm:gap-4">
      <div className="flex items-center gap-2">
        <Link
          href="/recipes"
          className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
        >
          &lsaquo; Recipes
        </Link>
        <h1 className="text-xl font-bold tracking-tight text-primary">This Week</h1>
      </div>

      {errorMessage && (
        <p className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
          {errorMessage}
        </p>
      )}

      {isLoading ? (
        <p className="p-1 text-sm text-muted-foreground">Loading This Week...</p>
      ) : queue.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            No recipes queued yet. Add recipes you plan to make soon from their recipe page.
          </p>
          <Link
            href="/recipes"
            className="min-h-11 flex items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 active:bg-primary/80"
          >
            Browse Recipes
          </Link>
        </div>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border sm:rounded-2xl sm:border sm:border-border">
            {queue.map((entry) => {
              const originalServings = parseNumericServings(entry.servings);
              return (
                <li key={entry.id} className="flex flex-col gap-1.5 px-2.5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      href={`/recipes/${entry.recipe_id}`}
                      className="min-w-0 flex-1 truncate text-[15px] font-medium text-foreground transition hover:text-primary"
                    >
                      {entry.title}
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleRemove(entry)}
                      className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-danger"
                    >
                      Remove
                    </button>
                  </div>
                  {originalServings !== null && (
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        Recipe makes {originalServings} serving{originalServings === 1 ? "" : "s"}
                      </span>
                      <label className="flex items-center gap-1.5">
                        <span>Making:</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          value={desiredServingsValue(entry, originalServings)}
                          onChange={(event) => handleDesiredServingsChange(entry.id, event.target.value)}
                          onBlur={() => commitDesiredServings(entry)}
                          aria-label={`Desired servings for ${entry.title}`}
                          className="min-h-8 w-14 rounded-lg border border-border bg-surface-muted px-2 text-center text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                        <span>servings</span>
                      </label>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {!isReviewOpen && (
            <div className="flex justify-end">
              {isConfirmingClear ? (
                <div className="flex w-full flex-col gap-3 rounded-2xl border border-danger/30 bg-surface p-4">
                  <span className="text-sm text-foreground">
                    Clear This Week? All {queue.length} recipe{queue.length === 1 ? "" : "s"} currently in
                    This Week will be removed.
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setIsConfirmingClear(false)}
                      disabled={isClearing}
                      className="min-h-11 flex-1 rounded-xl bg-surface-muted px-4 text-sm font-semibold text-foreground transition hover:bg-border disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleClearThisWeek}
                      disabled={isClearing}
                      className="min-h-11 flex-1 rounded-xl bg-danger px-4 text-sm font-semibold text-primary-foreground transition hover:bg-danger/90 disabled:opacity-50"
                    >
                      {isClearing ? "Clearing..." : "Clear This Week"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsConfirmingClear(true)}
                  className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
                >
                  Clear This Week
                </button>
              )}
            </div>
          )}

          {!isReviewOpen && (
            <button
              type="button"
              onClick={openReview}
              disabled={isLoadingReviewLines}
              className="min-h-11 flex items-center justify-center rounded-xl bg-primary px-4 text-base font-medium text-primary-foreground transition hover:bg-primary/90 active:bg-primary/80 disabled:opacity-50"
            >
              {isLoadingReviewLines ? "Loading ingredients..." : "Add to shopping list"}
            </button>
          )}

          {isReviewOpen && (
            <IngredientReviewPanel
              lines={reviewLines}
              onCancel={() => setIsReviewOpen(false)}
              onAdded={() => setIsReviewOpen(false)}
              onToast={showToast}
            />
          )}
        </>
      )}

      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
    </div>
  );
}

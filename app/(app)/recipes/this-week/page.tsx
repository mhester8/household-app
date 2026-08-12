"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { sortByPosition } from "@/lib/recipes";
import { sortByAddedAt, type ThisWeekRecipe } from "@/lib/thisWeek";
import { IngredientReviewPanel, type IngredientReviewLine } from "@/components/IngredientReviewPanel";
import { Toast, type ToastState } from "@/components/Toast";

const ERROR_TOAST_MS = 6000;

type QueuedRecipe = ThisWeekRecipe & { title: string };

export default function ThisWeekPage() {
  const [queue, setQueue] = useState<QueuedRecipe[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [isLoadingReviewLines, setIsLoadingReviewLines] = useState(false);
  const [reviewLines, setReviewLines] = useState<IngredientReviewLine[]>([]);

  useEffect(() => {
    async function loadQueue() {
      setIsLoading(true);
      setErrorMessage(null);

      const { data: rows, error: rowsError } = await supabase
        .from("this_week_recipes")
        .select("id, recipe_id, added_at")
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
        .select("id, title")
        .in("id", recipeIds);

      if (recipesError) {
        setErrorMessage(`Could not load This Week: ${recipesError.message}`);
        setIsLoading(false);
        return;
      }

      const titleByRecipeId = new Map((recipesData ?? []).map((recipe) => [recipe.id, recipe.title]));
      setQueue(
        (rows ?? []).map((row) => ({
          ...row,
          title: titleByRecipeId.get(row.recipe_id) ?? "Untitled recipe",
        }))
      );
      setIsLoading(false);
    }

    loadQueue();
  }, []);

  // Smallest Realtime setup for a shared queue: watch inserts/deletes only
  // (rows are never updated). An INSERT payload only carries the
  // this_week_recipes row, so a follow-up query fetches the recipe's title
  // before it's added to the list — same shape as the recipes list page's
  // own INSERT handler.
  useEffect(() => {
    const channel = supabase
      .channel("this_week_changes")
      .on<ThisWeekRecipe>(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "this_week_recipes" },
        async (payload) => {
          const row = payload.new as ThisWeekRecipe;
          const { data: recipeRow } = await supabase
            .from("recipes")
            .select("title")
            .eq("id", row.recipe_id)
            .maybeSingle();

          setQueue((current) => {
            if (current.some((entry) => entry.id === row.id)) {
              return current;
            }
            return sortByAddedAt([...current, { ...row, title: recipeRow?.title ?? "Untitled recipe" }]);
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "this_week_recipes" },
        (payload) => {
          const deletedId = (payload.old as { id: string }).id;
          setQueue((current) => current.filter((entry) => entry.id !== deletedId));
        }
      )
      .subscribe((status, err) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("Supabase Realtime subscription issue:", status, err);
          setErrorMessage(
            `Realtime updates are unavailable (${status}). Other people's changes won't appear until you refresh.`
          );
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

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

  async function openReview() {
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
    // database.
    const lines: IngredientReviewLine[] = queue.flatMap((entry) =>
      sortByPosition(data.filter((ingredient) => ingredient.recipe_id === entry.recipe_id)).map(
        (ingredient) => ({ id: ingredient.id, text: ingredient.text, groupLabel: entry.title })
      )
    );

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
            {queue.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-2 px-2.5 py-3">
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
              </li>
            ))}
          </ul>

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

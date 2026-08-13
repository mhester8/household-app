"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import {
  removeLineById,
  sortByPosition,
  upsertLine,
  type Recipe,
  type RecipeIngredient,
  type RecipeStep,
} from "@/lib/recipes";
import type { ThisWeekRecipe } from "@/lib/thisWeek";
import { IngredientReviewPanel, type IngredientReviewLine } from "@/components/IngredientReviewPanel";
import { Toast, type ToastState } from "@/components/Toast";
import { detailTimeSegments } from "@/lib/recipeTime";

// Matches the toast durations used on the groceries page for the same tone.
const ERROR_TOAST_MS = 6000;

export default function RecipeDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const recipeId = params.id;

  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([]);
  const [steps, setSteps] = useState<RecipeStep[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [realtimeError, setRealtimeError] = useState<string | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // "Add to shopping list" review panel — conditionally rendered, so opening
  // it always mounts a fresh IngredientReviewPanel with clean state.
  const [isShoppingPanelOpen, setIsShoppingPanelOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // This Week queue membership for this recipe. thisWeekRowId is the
  // this_week_recipes row id, needed to know a delete has a row to target;
  // null while unqueued or before the initial lookup resolves.
  const [isInThisWeek, setIsInThisWeek] = useState(false);
  const [thisWeekRowId, setThisWeekRowId] = useState<string | null>(null);
  const [isTogglingThisWeek, setIsTogglingThisWeek] = useState(false);

  useEffect(() => {
    async function loadRecipe() {
      setIsLoading(true);
      setLoadError(null);

      const [recipeResult, ingredientsResult, stepsResult] = await Promise.all([
        supabase
          .from("recipes")
          .select(
            "id, title, source_url, notes, servings, prep_time_minutes, cook_time_minutes, total_time_minutes, created_at"
          )
          .eq("id", recipeId)
          .maybeSingle(),
        supabase.from("recipe_ingredients").select("id, recipe_id, position, text").eq("recipe_id", recipeId),
        supabase.from("recipe_steps").select("id, recipe_id, position, text").eq("recipe_id", recipeId),
      ]);

      if (recipeResult.error || !recipeResult.data) {
        setLoadError(recipeResult.error ? recipeResult.error.message : "Recipe not found.");
        setIsLoading(false);
        return;
      }
      if (ingredientsResult.error || stepsResult.error) {
        setLoadError(ingredientsResult.error?.message ?? stepsResult.error?.message ?? "Unknown error");
        setIsLoading(false);
        return;
      }

      setRecipe(recipeResult.data);
      setIngredients(sortByPosition(ingredientsResult.data ?? []));
      setSteps(sortByPosition(stepsResult.data ?? []));
      setIsLoading(false);
    }

    loadRecipe();
  }, [recipeId]);

  // Look up whether this recipe is already queued in This Week, independent
  // of the recipe load above (a failure here shouldn't block viewing the
  // recipe — it just leaves the toggle showing "Add to This Week").
  useEffect(() => {
    async function loadThisWeekStatus() {
      const { data } = await supabase
        .from("this_week_recipes")
        .select("id")
        .eq("recipe_id", recipeId)
        .maybeSingle();

      setIsInThisWeek(!!data);
      setThisWeekRowId(data?.id ?? null);
    }

    loadThisWeekStatus();
  }, [recipeId]);

  // Subscribe to Realtime changes for this one recipe so another device's
  // edit to it (or to its ingredients/steps, or its This Week membership)
  // shows up here without a refresh. Scoped to recipeId via the
  // postgres_changes filter, same approach as the shopping list's channel,
  // just narrowed to one row.
  useEffect(() => {
    const channel = supabase
      .channel("recipe_detail_changes")
      .on<Recipe>(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "recipes", filter: `id=eq.${recipeId}` },
        (payload) => {
          setRecipe(payload.new as Recipe);
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "recipes", filter: `id=eq.${recipeId}` },
        () => {
          // Deleted from another device while this one is looking at it —
          // there's nothing left to show, so leave for the list.
          router.push("/recipes");
        }
      )
      .on<RecipeIngredient>(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "recipe_ingredients",
          filter: `recipe_id=eq.${recipeId}`,
        },
        (payload) => {
          setIngredients((current) => upsertLine(current, payload.new as RecipeIngredient));
        }
      )
      .on<RecipeIngredient>(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "recipe_ingredients",
          filter: `recipe_id=eq.${recipeId}`,
        },
        (payload) => {
          setIngredients((current) => upsertLine(current, payload.new as RecipeIngredient));
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "recipe_ingredients",
          filter: `recipe_id=eq.${recipeId}`,
        },
        (payload) => {
          const deletedId = (payload.old as { id: string }).id;
          setIngredients((current) => removeLineById(current, deletedId));
        }
      )
      .on<RecipeStep>(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "recipe_steps", filter: `recipe_id=eq.${recipeId}` },
        (payload) => {
          setSteps((current) => upsertLine(current, payload.new as RecipeStep));
        }
      )
      .on<RecipeStep>(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "recipe_steps", filter: `recipe_id=eq.${recipeId}` },
        (payload) => {
          setSteps((current) => upsertLine(current, payload.new as RecipeStep));
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "recipe_steps", filter: `recipe_id=eq.${recipeId}` },
        (payload) => {
          const deletedId = (payload.old as { id: string }).id;
          setSteps((current) => removeLineById(current, deletedId));
        }
      )
      .on<ThisWeekRecipe>(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "this_week_recipes", filter: `recipe_id=eq.${recipeId}` },
        (payload) => {
          const row = payload.new as ThisWeekRecipe;
          setIsInThisWeek(true);
          setThisWeekRowId(row.id);
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "this_week_recipes", filter: `recipe_id=eq.${recipeId}` },
        () => {
          setIsInThisWeek(false);
          setThisWeekRowId(null);
        }
      )
      .subscribe((status, err) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("Supabase Realtime subscription issue:", status, err);
          setRealtimeError(
            `Realtime updates are unavailable (${status}). Other people's changes won't appear until you refresh.`
          );
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [recipeId, router]);

  async function handleDelete() {
    setIsDeleting(true);
    setDeleteError(null);

    const { error } = await supabase.from("recipes").delete().eq("id", recipeId);

    if (error) {
      setDeleteError(error.message);
      setIsDeleting(false);
      return;
    }

    router.push("/recipes");
  }

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

  async function handleToggleThisWeek() {
    setIsTogglingThisWeek(true);

    if (isInThisWeek) {
      const previousRowId = thisWeekRowId;
      setIsInThisWeek(false);
      setThisWeekRowId(null);

      const { error } = await supabase.from("this_week_recipes").delete().eq("recipe_id", recipeId);

      if (error) {
        setIsInThisWeek(true);
        setThisWeekRowId(previousRowId);
        showToast(
          {
            message: "Couldn't remove from This Week",
            actionLabel: "Retry",
            onAction: () => handleToggleThisWeek(),
            tone: "danger",
          },
          ERROR_TOAST_MS
        );
      }
    } else {
      setIsInThisWeek(true);

      const { data, error } = await supabase
        .from("this_week_recipes")
        .insert({ recipe_id: recipeId })
        .select("id")
        .single();

      if (error) {
        // A unique-constraint violation means another device already queued
        // this recipe — the row exists either way, so this is a success, not
        // a failure. Look up its id so a later remove has something to
        // target instead of leaving thisWeekRowId stale.
        if (error.code === "23505") {
          const { data: existing } = await supabase
            .from("this_week_recipes")
            .select("id")
            .eq("recipe_id", recipeId)
            .maybeSingle();
          setThisWeekRowId(existing?.id ?? null);
        } else {
          setIsInThisWeek(false);
          showToast(
            {
              message: "Couldn't add to This Week",
              actionLabel: "Retry",
              onAction: () => handleToggleThisWeek(),
              tone: "danger",
            },
            ERROR_TOAST_MS
          );
        }
      } else {
        setThisWeekRowId(data.id);
      }
    }

    setIsTogglingThisWeek(false);
  }

  const reviewLines: IngredientReviewLine[] = ingredients.map((ingredient) => ({
    id: ingredient.id,
    text: ingredient.text,
  }));

  const timeSegments = recipe
    ? detailTimeSegments({
        prepTimeMinutes: recipe.prep_time_minutes,
        cookTimeMinutes: recipe.cook_time_minutes,
        totalTimeMinutes: recipe.total_time_minutes,
      })
    : [];

  return (
    <div className="flex flex-col gap-2 sm:gap-4">
      <div className="flex items-center gap-2">
        <Link
          href="/recipes"
          className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
        >
          &lsaquo; Recipes
        </Link>
      </div>

      {realtimeError && (
        <p className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
          {realtimeError}
        </p>
      )}

      {isLoading ? (
        <p className="p-1 text-sm text-muted-foreground">Loading recipe...</p>
      ) : loadError || !recipe ? (
        <p className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
          {loadError ?? "Recipe not found."}
        </p>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <h1 className="min-w-0 break-words text-xl font-bold tracking-tight text-primary">
              {recipe.title}
            </h1>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={handleToggleThisWeek}
                disabled={isTogglingThisWeek}
                className="rounded-full bg-surface-muted px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-border disabled:opacity-50"
              >
                {isInThisWeek ? "Remove from This Week" : "Add to This Week"}
              </button>
              <Link
                href={`/recipes/${recipe.id}/edit`}
                className="flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
              >
                Edit
              </Link>
            </div>
          </div>

          {recipe.servings && (
            <p className="text-sm text-muted-foreground">Servings: {recipe.servings}</p>
          )}

          {timeSegments.length > 0 && (
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {timeSegments.map((segment) => (
                <span key={segment.label}>
                  {segment.label}: {segment.text}
                </span>
              ))}
            </p>
          )}

          {recipe.source_url && (
            <a
              href={recipe.source_url}
              target="_blank"
              rel="noreferrer noopener"
              className="break-words text-sm text-primary underline underline-offset-2"
            >
              {recipe.source_url}
            </a>
          )}

          {recipe.notes && (
            <p className="whitespace-pre-wrap break-words rounded-xl border border-border bg-surface-muted px-3.5 py-2.5 text-sm text-foreground">
              {recipe.notes}
            </p>
          )}

          {ingredients.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">Ingredients</h2>
                {!isShoppingPanelOpen && (
                  <button
                    type="button"
                    onClick={() => setIsShoppingPanelOpen(true)}
                    className="rounded-full bg-surface-muted px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-border"
                  >
                    Add to shopping list
                  </button>
                )}
              </div>
              <ul className="flex flex-col gap-1 rounded-xl border border-border bg-surface px-3.5 py-2.5">
                {ingredients.map((ingredient) => (
                  <li key={ingredient.id} className="break-words text-[15px] text-foreground">
                    {ingredient.text}
                  </li>
                ))}
              </ul>
              {isShoppingPanelOpen && (
                <IngredientReviewPanel
                  lines={reviewLines}
                  onCancel={() => setIsShoppingPanelOpen(false)}
                  onAdded={() => setIsShoppingPanelOpen(false)}
                  onToast={showToast}
                />
              )}
            </div>
          )}

          {steps.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <h2 className="text-sm font-semibold text-foreground">Steps</h2>
              <ol className="flex flex-col gap-2 rounded-xl border border-border bg-surface px-3.5 py-2.5">
                {steps.map((step, index) => (
                  <li key={step.id} className="flex gap-2 break-words text-[15px] text-foreground">
                    <span className="shrink-0 font-semibold text-muted-foreground">{index + 1}.</span>
                    <span className="whitespace-pre-wrap">{step.text}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {deleteError && (
            <p className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
              {deleteError}
            </p>
          )}

          {isConfirmingDelete ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-danger/30 bg-surface p-4">
              <span className="text-sm text-foreground">
                Delete <span className="font-semibold">{recipe.title}</span>? This can&rsquo;t be undone.
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsConfirmingDelete(false)}
                  disabled={isDeleting}
                  className="min-h-11 flex-1 rounded-xl bg-surface-muted px-4 text-sm font-semibold text-foreground transition hover:bg-border disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="min-h-11 flex-1 rounded-xl bg-danger px-4 text-sm font-semibold text-primary-foreground transition hover:bg-danger/90 disabled:opacity-50"
                >
                  {isDeleting ? "Deleting..." : "Delete Recipe"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsConfirmingDelete(true)}
              className="min-h-11 rounded-xl px-4 text-sm font-semibold text-danger transition hover:bg-danger/10"
            >
              Delete Recipe
            </button>
          )}
        </>
      )}

      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
    </div>
  );
}

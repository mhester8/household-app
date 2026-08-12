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
import {
  findActiveDuplicate,
  insertGroceryItems,
  type GroceryItem,
} from "@/lib/groceryItems";
import { Toast, type ToastState } from "@/components/Toast";

// Matches the toast durations used on the groceries page for the same tones.
const SUCCESS_TOAST_MS = 4000;
const ERROR_TOAST_MS = 6000;
const INFO_TOAST_MS = 3000;

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

  // "Add to shopping list" review panel. activeGroceryItems is null until the
  // panel's duplicate-check fetch resolves; once loaded, ingredients that
  // match an active grocery item (via the same normalization the manual add
  // form uses) are shown disabled/unchecked instead of being silently
  // dropped at submit time.
  const [isShoppingPanelOpen, setIsShoppingPanelOpen] = useState(false);
  const [activeGroceryItems, setActiveGroceryItems] = useState<GroceryItem[] | null>(null);
  const [isLoadingActiveItems, setIsLoadingActiveItems] = useState(false);
  const [loadActiveItemsError, setLoadActiveItemsError] = useState<string | null>(null);
  const [selectedIngredientIds, setSelectedIngredientIds] = useState<Set<string>>(new Set());
  const [isSubmittingAdd, setIsSubmittingAdd] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    async function loadRecipe() {
      setIsLoading(true);
      setLoadError(null);

      const [recipeResult, ingredientsResult, stepsResult] = await Promise.all([
        supabase
          .from("recipes")
          .select("id, title, source_url, notes, created_at")
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

  // Subscribe to Realtime changes for this one recipe so another device's
  // edit to it (or to its ingredients/steps) shows up here without a
  // refresh. Scoped to recipeId via the postgres_changes filter, same
  // approach as the shopping list's channel, just narrowed to one row.
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

  async function openShoppingPanel() {
    setIsShoppingPanelOpen(true);
    setLoadActiveItemsError(null);
    setIsLoadingActiveItems(true);

    const { data, error } = await supabase
      .from("grocery_items")
      .select("id, name, completed, created_at")
      .eq("completed", false);

    // If the duplicate check itself fails, don't block the flow on it —
    // fall back to treating nothing as a known duplicate so every ingredient
    // stays selectable.
    const active = error || !data ? [] : data;
    if (error) {
      setLoadActiveItemsError(error.message);
    }

    setActiveGroceryItems(active);
    setSelectedIngredientIds(
      new Set(
        ingredients
          .filter((ingredient) => !findActiveDuplicate(active, ingredient.text))
          .map((ingredient) => ingredient.id)
      )
    );
    setIsLoadingActiveItems(false);
  }

  function closeShoppingPanel() {
    setIsShoppingPanelOpen(false);
    setActiveGroceryItems(null);
    setSelectedIngredientIds(new Set());
    setLoadActiveItemsError(null);
  }

  function toggleIngredientSelected(id: string) {
    setSelectedIngredientIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleAddSelectedToShoppingList() {
    const selected = ingredients.filter((ingredient) => selectedIngredientIds.has(ingredient.id));
    if (selected.length === 0) {
      return;
    }

    setIsSubmittingAdd(true);

    // Another device could have added one of these since the panel opened —
    // re-check right before inserting and quietly drop anything that's now
    // a duplicate. Unlike the panel-open check, a failure here must abort
    // instead of falling back to the stale selection: inserting without a
    // successful recheck could create a duplicate the user can no longer see
    // was ever a risk.
    const { data: freshActive, error: freshActiveError } = await supabase
      .from("grocery_items")
      .select("id, name, completed, created_at")
      .eq("completed", false);

    if (freshActiveError || !freshActive) {
      setIsSubmittingAdd(false);
      showToast(
        {
          message: "Couldn't verify the shopping list. Try again.",
          actionLabel: "Retry",
          onAction: () => handleAddSelectedToShoppingList(),
          tone: "danger",
        },
        ERROR_TOAST_MS
      );
      return;
    }

    const toInsert = selected.filter((ingredient) => !findActiveDuplicate(freshActive, ingredient.text));
    const skippedCount = selected.length - toInsert.length;

    if (toInsert.length === 0) {
      setIsSubmittingAdd(false);
      closeShoppingPanel();
      showToast({ message: "Those items are already on the shopping list" }, INFO_TOAST_MS);
      return;
    }

    try {
      await insertGroceryItems(
        toInsert.map((ingredient) => ({ id: crypto.randomUUID(), name: ingredient.text }))
      );
      setIsSubmittingAdd(false);
      closeShoppingPanel();
      const itemWord = toInsert.length === 1 ? "item" : "items";
      showToast(
        {
          message:
            skippedCount > 0
              ? `Added ${toInsert.length} ${itemWord} (${skippedCount} already on the list)`
              : `Added ${toInsert.length} ${itemWord} to the shopping list`,
        },
        SUCCESS_TOAST_MS
      );
    } catch {
      setIsSubmittingAdd(false);
      showToast(
        {
          message: "Couldn't add items to the shopping list",
          actionLabel: "Retry",
          onAction: () => handleAddSelectedToShoppingList(),
          tone: "danger",
        },
        ERROR_TOAST_MS
      );
    }
  }

  const duplicateIngredientIds = activeGroceryItems
    ? new Set(
        ingredients
          .filter((ingredient) => findActiveDuplicate(activeGroceryItems, ingredient.text))
          .map((ingredient) => ingredient.id)
      )
    : new Set<string>();
  const selectableCount = ingredients.length - duplicateIngredientIds.size;

  function renderShoppingListPanel() {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
        <span className="text-sm font-semibold text-foreground">
          Add ingredients to the shopping list
        </span>

        {loadActiveItemsError && (
          <p className="text-xs text-muted-foreground">
            Couldn&rsquo;t check your shopping list for duplicates ({loadActiveItemsError}). Showing
            all ingredients as selectable.
          </p>
        )}

        {isLoadingActiveItems || activeGroceryItems === null ? (
          <p className="text-sm text-muted-foreground">Checking your shopping list...</p>
        ) : (
          <>
            <ul className="flex flex-col gap-1">
              {ingredients.map((ingredient) => {
                const isDuplicate = duplicateIngredientIds.has(ingredient.id);
                const isChecked = selectedIngredientIds.has(ingredient.id);
                return (
                  <li key={ingredient.id}>
                    <label
                      className={`flex min-h-11 items-center gap-2.5 rounded-lg px-1.5 py-1 text-[15px] ${
                        isDuplicate ? "text-muted-foreground" : "text-foreground"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={isDuplicate}
                        onChange={() => toggleIngredientSelected(ingredient.id)}
                        className="h-5 w-5 shrink-0 rounded border-border/80 text-primary focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                      />
                      <span className="min-w-0 flex-1 break-words">{ingredient.text}</span>
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

            {selectableCount === 0 && (
              <p className="text-sm text-muted-foreground">
                All ingredients are already on the shopping list.
              </p>
            )}
          </>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={closeShoppingPanel}
            disabled={isSubmittingAdd}
            className="min-h-11 flex-1 rounded-xl bg-surface-muted px-4 text-sm font-semibold text-foreground transition hover:bg-border disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAddSelectedToShoppingList}
            disabled={isSubmittingAdd || isLoadingActiveItems || selectedIngredientIds.size === 0}
            className="min-h-11 flex-1 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
          >
            {isSubmittingAdd
              ? "Adding..."
              : `Add ${selectedIngredientIds.size} item${selectedIngredientIds.size === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    );
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
            <div className="flex shrink-0 gap-2">
              <Link
                href={`/recipes/${recipe.id}/edit`}
                className="flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
              >
                Edit
              </Link>
            </div>
          </div>

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
                    onClick={openShoppingPanel}
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
              {isShoppingPanelOpen && renderShoppingListPanel()}
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

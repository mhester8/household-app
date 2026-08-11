"use client";

import { useEffect, useState } from "react";
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
              <h2 className="text-sm font-semibold text-foreground">Ingredients</h2>
              <ul className="flex flex-col gap-1 rounded-xl border border-border bg-surface px-3.5 py-2.5">
                {ingredients.map((ingredient) => (
                  <li key={ingredient.id} className="break-words text-[15px] text-foreground">
                    {ingredient.text}
                  </li>
                ))}
              </ul>
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
    </div>
  );
}

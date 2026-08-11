"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { sortRecipesByCreatedAt, type Recipe } from "@/lib/recipes";

type RecipeWithCount = Recipe & { ingredientCount: number };

export default function RecipesPage() {
  const [recipes, setRecipes] = useState<RecipeWithCount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function loadRecipes() {
      setIsLoading(true);
      setErrorMessage(null);

      const [recipesResult, ingredientsResult] = await Promise.all([
        supabase
          .from("recipes")
          .select("id, title, source_url, notes, created_at")
          .order("created_at", { ascending: true }),
        supabase.from("recipe_ingredients").select("recipe_id"),
      ]);

      if (recipesResult.error || ingredientsResult.error) {
        setErrorMessage(
          `Could not load recipes: ${
            recipesResult.error?.message ?? ingredientsResult.error?.message
          }`
        );
        setIsLoading(false);
        return;
      }

      const countByRecipeId = new Map<string, number>();
      for (const row of ingredientsResult.data ?? []) {
        countByRecipeId.set(row.recipe_id, (countByRecipeId.get(row.recipe_id) ?? 0) + 1);
      }

      setRecipes(
        (recipesResult.data ?? []).map((recipe) => ({
          ...recipe,
          ingredientCount: countByRecipeId.get(recipe.id) ?? 0,
        }))
      );
      setIsLoading(false);
    }

    loadRecipes();
  }, []);

  // Subscribe to Realtime changes so another device's adds/edits/deletes show
  // up here without a refresh. Only the recipes table is watched — ingredient
  // counts for existing rows are a nice-to-have, not something this list
  // needs to keep live, so a brand new recipe's count is fetched once here
  // and edits to an existing recipe's ingredients don't otherwise touch this
  // list (they're reflected on the detail page instead).
  useEffect(() => {
    const channel = supabase
      .channel("recipes_changes")
      .on<Recipe>(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "recipes" },
        async (payload) => {
          const newRecipe = payload.new as Recipe;
          const { count } = await supabase
            .from("recipe_ingredients")
            .select("id", { count: "exact", head: true })
            .eq("recipe_id", newRecipe.id);

          setRecipes((current) => {
            if (current.some((recipe) => recipe.id === newRecipe.id)) {
              return current;
            }
            return sortRecipesByCreatedAt([
              ...current,
              { ...newRecipe, ingredientCount: count ?? 0 },
            ]);
          });
        }
      )
      .on<Recipe>(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "recipes" },
        (payload) => {
          const updated = payload.new as Recipe;
          setRecipes((current) =>
            current.map((recipe) => (recipe.id === updated.id ? { ...recipe, ...updated } : recipe))
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "recipes" },
        (payload) => {
          const deletedId = (payload.old as { id: string }).id;
          setRecipes((current) => current.filter((recipe) => recipe.id !== deletedId));
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

  return (
    <div className="flex flex-col gap-2 sm:gap-4">
      <div className="flex items-center gap-2">
        <Link
          href="/"
          className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
        >
          &lsaquo; Home
        </Link>
        <h1 className="text-xl font-bold tracking-tight text-primary">Recipes</h1>
      </div>

      {errorMessage && (
        <p className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
          {errorMessage}
        </p>
      )}

      {isLoading ? (
        <p className="p-1 text-sm text-muted-foreground">Loading recipes...</p>
      ) : (
        <>
          <Link
            href="/recipes/new"
            className="min-h-11 flex items-center justify-center rounded-xl bg-primary px-4 text-base font-medium text-primary-foreground transition hover:bg-primary/90 active:bg-primary/80"
          >
            + New Recipe
          </Link>

          <ul className="flex flex-col divide-y divide-border sm:rounded-2xl sm:border sm:border-border">
            {recipes.map((recipe) => (
              <li key={recipe.id}>
                <Link
                  href={`/recipes/${recipe.id}`}
                  className="flex items-center justify-between gap-2 px-2.5 py-3 transition hover:bg-surface-muted"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[15px] font-medium text-foreground">
                      {recipe.title}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {recipe.ingredientCount} ingredient{recipe.ingredientCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <span aria-hidden="true" className="shrink-0 text-xl text-primary">
                    &rsaquo;
                  </span>
                </Link>
              </li>
            ))}
            {recipes.length === 0 && (
              <li className="px-1 py-6 text-center text-sm text-muted-foreground">
                No recipes yet. Add one to get started.
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { sortRecipesByCreatedAt, type Recipe } from "@/lib/recipes";
import { gridCardMetadataLine } from "@/lib/recipeCardMeta";
import { RecipeCard } from "@/components/RecipeCard";
import { REALTIME_UNAVAILABLE_MESSAGE, useRealtimeSubscription } from "@/lib/useRealtimeSubscription";

// Ingredient texts are kept per-recipe for the search box (title-or-
// ingredient matching below) — the ingredient count itself is no longer
// shown on the card, only used for search.
type RecipeWithIngredientTexts = Recipe & { ingredientTexts: string[] };

export default function RecipesPage() {
  const [recipes, setRecipes] = useState<RecipeWithIngredientTexts[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isChoosingRecipeType, setIsChoosingRecipeType] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    async function loadRecipes() {
      setIsLoading(true);
      setErrorMessage(null);

      const [recipesResult, ingredientsResult] = await Promise.all([
        supabase
          .from("recipes")
          .select(
            "id, title, source_url, notes, servings, prep_time_minutes, cook_time_minutes, total_time_minutes, image_url, created_at"
          )
          .order("created_at", { ascending: true }),
        supabase.from("recipe_ingredients").select("recipe_id, text"),
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

      const textsByRecipeId = new Map<string, string[]>();
      for (const row of ingredientsResult.data ?? []) {
        const texts = textsByRecipeId.get(row.recipe_id) ?? [];
        texts.push(row.text);
        textsByRecipeId.set(row.recipe_id, texts);
      }

      setRecipes(
        (recipesResult.data ?? []).map((recipe) => ({
          ...recipe,
          ingredientTexts: textsByRecipeId.get(recipe.id) ?? [],
        }))
      );
      setIsLoading(false);
    }

    loadRecipes();
  }, []);

  // Subscribe to Realtime changes so another device's adds/edits/deletes show
  // up here without a refresh. Only the recipes table is watched — a brand
  // new recipe's ingredients haven't been inserted yet at the moment its own
  // INSERT event fires (createRecipe writes the recipe row first, then its
  // children), so it's added here with an empty ingredientTexts rather than
  // fetched; edits to an existing recipe's ingredients don't otherwise touch
  // this list (they're reflected on the detail page instead, and in search
  // after a refresh).
  useRealtimeSubscription({
    channelName: "recipes_changes",
    deps: [],
    build: (channel) =>
      channel
        .on<Recipe>(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "recipes" },
          (payload) => {
            const newRecipe = payload.new as Recipe;
            setRecipes((current) => {
              if (current.some((recipe) => recipe.id === newRecipe.id)) {
                return current;
              }
              return sortRecipesByCreatedAt([...current, { ...newRecipe, ingredientTexts: [] }]);
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
        ),
    onUnavailable: () => setErrorMessage(REALTIME_UNAVAILABLE_MESSAGE),
    onRecovered: () =>
      setErrorMessage((current) => (current === REALTIME_UNAVAILABLE_MESSAGE ? null : current)),
  });

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredRecipes = normalizedQuery
    ? recipes.filter(
        (recipe) =>
          recipe.title.toLowerCase().includes(normalizedQuery) ||
          recipe.ingredientTexts.some((text) => text.toLowerCase().includes(normalizedQuery))
      )
    : recipes;

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
          {isChoosingRecipeType ? (
            <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-2">
              <Link
                href="/recipes/new"
                className="min-h-11 flex items-center justify-center rounded-xl bg-primary px-4 text-base font-medium text-primary-foreground transition hover:bg-primary/90 active:bg-primary/80"
              >
                Write Manually
              </Link>
              <Link
                href="/recipes/import"
                className="min-h-11 flex items-center justify-center rounded-xl bg-surface-muted px-4 text-base font-medium text-foreground transition hover:bg-border"
              >
                From Photo
              </Link>
              <Link
                href="/recipes/import-url"
                className="min-h-11 flex items-center justify-center rounded-xl bg-surface-muted px-4 text-base font-medium text-foreground transition hover:bg-border"
              >
                From URL
              </Link>
              <Link
                href="/pinterest"
                className="min-h-11 flex items-center justify-center rounded-xl bg-surface-muted px-4 text-base font-medium text-foreground transition hover:bg-border"
              >
                From Pinterest
              </Link>
              <button
                type="button"
                onClick={() => setIsChoosingRecipeType(false)}
                className="min-h-11 rounded-xl px-4 text-sm font-semibold text-muted-foreground transition hover:bg-surface-muted"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsChoosingRecipeType(true)}
              className="min-h-11 flex items-center justify-center rounded-xl bg-primary px-4 text-base font-medium text-primary-foreground transition hover:bg-primary/90 active:bg-primary/80"
            >
              + New Recipe
            </button>
          )}

          {recipes.length > 0 && (
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search recipes or ingredients..."
              aria-label="Search recipes"
              autoComplete="off"
              className="min-h-11 rounded-xl border border-border bg-surface-muted px-3.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          )}

          <ul className="grid grid-cols-2 gap-2.5">
            {filteredRecipes.map((recipe) => {
              const metadata = gridCardMetadataLine(
                {
                  prepTimeMinutes: recipe.prep_time_minutes,
                  cookTimeMinutes: recipe.cook_time_minutes,
                  totalTimeMinutes: recipe.total_time_minutes,
                },
                recipe.servings
              );
              return (
                <li key={recipe.id}>
                  <RecipeCard
                    href={`/recipes/${recipe.id}`}
                    title={recipe.title}
                    imageUrl={recipe.image_url}
                    metadata={metadata}
                  />
                </li>
              );
            })}
            {recipes.length === 0 && (
              <li className="col-span-2 px-1 py-6 text-center text-sm text-muted-foreground">
                No recipes yet. Add one to get started.
              </li>
            )}
            {recipes.length > 0 && filteredRecipes.length === 0 && (
              <li className="col-span-2 px-1 py-6 text-center text-sm text-muted-foreground">
                No recipes match &ldquo;{searchQuery.trim()}&rdquo;.
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}

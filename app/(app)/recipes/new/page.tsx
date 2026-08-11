"use client";

import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { RecipeForm, newDraftLine, type RecipeSaveInput } from "@/components/RecipeForm";

export default function NewRecipePage() {
  async function handleSave(input: RecipeSaveInput): Promise<string | null> {
    const { data: recipe, error: recipeError } = await supabase
      .from("recipes")
      .insert({ title: input.title, source_url: input.sourceUrl, notes: input.notes })
      .select("id")
      .single();

    if (recipeError || !recipe) {
      return `Couldn't save recipe: ${recipeError?.message ?? "unknown error"}`;
    }

    const { error: childrenError } = await insertChildren(recipe.id, input);

    if (childrenError) {
      await supabase.from("recipes").delete().eq("id", recipe.id);
      return `Couldn't save recipe: ${childrenError}`;
    }

    return null;
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
        <h1 className="text-xl font-bold tracking-tight text-primary">New Recipe</h1>
      </div>

      <RecipeForm
        initialTitle=""
        initialSourceUrl=""
        initialNotes=""
        initialIngredients={[newDraftLine()]}
        initialSteps={[newDraftLine()]}
        saveLabel="Save Recipe"
        onSave={handleSave}
      />
    </div>
  );
}

async function insertChildren(
  recipeId: string,
  input: RecipeSaveInput
): Promise<{ error: string | null }> {
  if (input.ingredients.length > 0) {
    const { error } = await supabase.from("recipe_ingredients").insert(
      input.ingredients.map((text, index) => ({ recipe_id: recipeId, position: index, text }))
    );
    if (error) {
      return { error: error.message };
    }
  }

  if (input.steps.length > 0) {
    const { error } = await supabase.from("recipe_steps").insert(
      input.steps.map((text, index) => ({ recipe_id: recipeId, position: index, text }))
    );
    if (error) {
      return { error: error.message };
    }
  }

  return { error: null };
}

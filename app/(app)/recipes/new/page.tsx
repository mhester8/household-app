"use client";

import Link from "next/link";
import { createRecipe } from "@/lib/recipes";
import { RecipeForm, newDraftLine, type RecipeSaveInput } from "@/components/RecipeForm";

export default function NewRecipePage() {
  async function handleSave(input: RecipeSaveInput): Promise<string | null> {
    const { error } = await createRecipe(input);
    return error;
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

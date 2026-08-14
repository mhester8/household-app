"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { createRecipe } from "@/lib/recipes";
import { RecipeForm, newDraftLine, type RecipeSaveInput } from "@/components/RecipeForm";
import { RecipeImageField } from "@/components/RecipeImageField";
import { uploadRecipeImage } from "@/lib/recipeImages";

export default function NewRecipePage() {
  // Set once createRecipe succeeds, so that if a subsequent image upload
  // fails and the user retries, handleSave re-attempts only the upload
  // against this same id instead of creating a second recipe row.
  const [createdRecipeId, setCreatedRecipeId] = useState<string | null>(null);
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);

  async function handleSave(input: RecipeSaveInput): Promise<string | null> {
    let recipeId = createdRecipeId;

    if (recipeId === null) {
      const { id, error } = await createRecipe(input);
      if (error || !id) {
        return error ?? "Couldn't save recipe.";
      }
      recipeId = id;
      setCreatedRecipeId(id);
    }

    if (selectedImageFile) {
      const uploadResult = await uploadRecipeImage(supabase, recipeId, selectedImageFile);
      if (uploadResult.error) {
        return uploadResult.error;
      }

      const { error: imageError } = await supabase
        .from("recipes")
        .update({ image_url: uploadResult.publicUrl })
        .eq("id", recipeId);

      if (imageError) {
        return `Couldn't save recipe: ${imageError.message}`;
      }
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

      <RecipeImageField currentImageUrl={null} onFileSelected={setSelectedImageFile} />

      <RecipeForm
        initialTitle=""
        initialSourceUrl=""
        initialNotes=""
        initialServings=""
        initialPrepTimeMinutes={null}
        initialCookTimeMinutes={null}
        initialTotalTimeMinutes={null}
        initialIngredients={[newDraftLine()]}
        initialSteps={[newDraftLine()]}
        saveLabel={createdRecipeId ? "Retry Photo Upload" : "Save Recipe"}
        onSave={handleSave}
      />
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { sortByPosition } from "@/lib/recipes";
import { RecipeForm, type RecipeDraftLine, type RecipeSaveInput } from "@/components/RecipeForm";
import { RecipeImageField } from "@/components/RecipeImageField";
import { deleteRecipeImageIfOwned, uploadRecipeImage } from "@/lib/recipeImages";
import { createId } from "@/lib/id";

export default function EditRecipePage() {
  const params = useParams<{ id: string }>();
  const recipeId = params.id;

  const [title, setTitle] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [servings, setServings] = useState("");
  const [prepTimeMinutes, setPrepTimeMinutes] = useState<number | null>(null);
  const [cookTimeMinutes, setCookTimeMinutes] = useState<number | null>(null);
  const [totalTimeMinutes, setTotalTimeMinutes] = useState<number | null>(null);
  const [ingredients, setIngredients] = useState<RecipeDraftLine[] | null>(null);
  const [steps, setSteps] = useState<RecipeDraftLine[] | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    async function loadRecipe() {
      setIsLoading(true);
      setLoadError(null);

      const [recipeResult, ingredientsResult, stepsResult] = await Promise.all([
        supabase
          .from("recipes")
          .select(
            "id, title, source_url, notes, servings, prep_time_minutes, cook_time_minutes, total_time_minutes, image_url"
          )
          .eq("id", recipeId)
          .maybeSingle(),
        supabase.from("recipe_ingredients").select("position, text").eq("recipe_id", recipeId),
        supabase.from("recipe_steps").select("position, text").eq("recipe_id", recipeId),
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

      setTitle(recipeResult.data.title);
      setSourceUrl(recipeResult.data.source_url ?? "");
      setNotes(recipeResult.data.notes ?? "");
      setServings(recipeResult.data.servings ?? "");
      setPrepTimeMinutes(recipeResult.data.prep_time_minutes ?? null);
      setCookTimeMinutes(recipeResult.data.cook_time_minutes ?? null);
      setTotalTimeMinutes(recipeResult.data.total_time_minutes ?? null);
      setImageUrl(recipeResult.data.image_url ?? null);
      setIngredients(
        sortByPosition(ingredientsResult.data ?? []).map((row) => ({
          key: createId(),
          text: row.text,
        }))
      );
      setSteps(
        sortByPosition(stepsResult.data ?? []).map((row) => ({
          key: createId(),
          text: row.text,
        }))
      );
      setIsLoading(false);
    }

    loadRecipe();
  }, [recipeId]);

  // Ingredient/step rows aren't referenced by anything else, so replacing
  // the whole set here (delete then reinsert in the new order) is safe —
  // same approach as the workout template edit flow.
  async function handleSave(input: RecipeSaveInput): Promise<string | null> {
    let nextImageUrl = imageUrl;

    // Upload before touching the recipe row at all — if this fails, the
    // recipe and its current image are left completely untouched.
    if (selectedImageFile) {
      const uploadResult = await uploadRecipeImage(supabase, recipeId, selectedImageFile);
      if (uploadResult.error) {
        return uploadResult.error;
      }
      nextImageUrl = uploadResult.publicUrl;
    }

    const { error: recipeError } = await supabase
      .from("recipes")
      .update({
        title: input.title,
        source_url: input.sourceUrl,
        notes: input.notes,
        servings: input.servings,
        prep_time_minutes: input.prepTimeMinutes,
        cook_time_minutes: input.cookTimeMinutes,
        total_time_minutes: input.totalTimeMinutes,
        image_url: nextImageUrl,
      })
      .eq("id", recipeId);

    if (recipeError) {
      return `Couldn't save recipe: ${recipeError.message}`;
    }

    // Only now that the new image is safely referenced by the recipe row,
    // clean up the old one — a no-op unless it was one of our own uploads
    // (never an external recipe-site image).
    if (selectedImageFile) {
      await deleteRecipeImageIfOwned(supabase, imageUrl);
    }

    const [deleteIngredientsResult, deleteStepsResult] = await Promise.all([
      supabase.from("recipe_ingredients").delete().eq("recipe_id", recipeId),
      supabase.from("recipe_steps").delete().eq("recipe_id", recipeId),
    ]);

    if (deleteIngredientsResult.error || deleteStepsResult.error) {
      return `Couldn't save recipe: ${
        deleteIngredientsResult.error?.message ?? deleteStepsResult.error?.message
      }`;
    }

    if (input.ingredients.length > 0) {
      const { error } = await supabase.from("recipe_ingredients").insert(
        input.ingredients.map((text, index) => ({ recipe_id: recipeId, position: index, text }))
      );
      if (error) {
        return `Couldn't save recipe: ${error.message}`;
      }
    }

    if (input.steps.length > 0) {
      const { error } = await supabase.from("recipe_steps").insert(
        input.steps.map((text, index) => ({ recipe_id: recipeId, position: index, text }))
      );
      if (error) {
        return `Couldn't save recipe: ${error.message}`;
      }
    }

    return null;
  }

  return (
    <div className="flex flex-col gap-2 sm:gap-4">
      <div className="flex items-center gap-2">
        <Link
          href={`/recipes/${recipeId}`}
          className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
        >
          &lsaquo; Recipe
        </Link>
        <h1 className="text-xl font-bold tracking-tight text-primary">Edit Recipe</h1>
      </div>

      {isLoading ? (
        <p className="p-1 text-sm text-muted-foreground">Loading recipe...</p>
      ) : loadError || title === null || ingredients === null || steps === null ? (
        <p className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
          {loadError ?? "Recipe not found."}
        </p>
      ) : (
        <>
          <RecipeImageField currentImageUrl={imageUrl} onFileSelected={setSelectedImageFile} />
          <RecipeForm
            initialTitle={title}
            initialSourceUrl={sourceUrl}
            initialNotes={notes}
            initialServings={servings}
            initialPrepTimeMinutes={prepTimeMinutes}
            initialCookTimeMinutes={cookTimeMinutes}
            initialTotalTimeMinutes={totalTimeMinutes}
            initialIngredients={ingredients}
            initialSteps={steps}
            saveLabel="Save Changes"
            onSave={handleSave}
          />
        </>
      )}
    </div>
  );
}

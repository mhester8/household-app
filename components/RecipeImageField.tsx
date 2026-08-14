"use client";

import { useEffect, useState } from "react";
import { LeafIcon } from "@/components/LeafIcon";
import { validateRecipeImageFile } from "@/lib/recipeImages";

// Used by both /recipes/new and the recipe edit page — reports a chosen
// File to its parent via onFileSelected, but never uploads itself. The
// parent uploads it as part of the existing create/Save action, so there's
// still exactly one save/commit point, same as every other field on the
// form. currentImageUrl is simply null for a brand-new recipe.
export function RecipeImageField({
  currentImageUrl,
  onFileSelected,
}: {
  currentImageUrl: string | null;
  onFileSelected: (file: File) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // Tracks a failed load of the *existing* image (dead link, blocked
  // hotlink, etc.), same as RecipeCard — irrelevant once a local preview
  // takes over, since a freshly created object URL always loads.
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = ""; // allow re-selecting the same file again later

    if (!file) {
      return;
    }

    const error = validateRecipeImageFile(file);
    if (error) {
      setValidationError(error);
      return;
    }

    setValidationError(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(URL.createObjectURL(file));
    onFileSelected(file);
  }

  const displayUrl = previewUrl ?? (imageLoadFailed ? null : currentImageUrl);
  const hasImage = displayUrl !== null;

  return (
    <div className="flex flex-col gap-2">
      <span className="px-1 text-xs font-medium text-muted-foreground">Photo</span>
      <div className="flex items-center gap-3">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-muted">
          {hasImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- may be a local blob: preview or an arbitrary external recipe-site image, same reasoning as RecipeCard
            <img
              src={displayUrl}
              alt=""
              onError={() => setImageLoadFailed(true)}
              className="h-full w-full object-cover"
            />
          ) : (
            <LeafIcon className="h-8 w-8 text-muted-foreground/60" />
          )}
        </div>

        <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-dashed border-border px-4 text-sm font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground">
          {hasImage ? "Replace Photo" : "Add Photo"}
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            aria-label="Recipe photo"
            className="hidden"
          />
        </label>
      </div>

      {validationError && (
        <p className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
          {validationError}
        </p>
      )}
    </div>
  );
}

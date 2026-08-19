"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { createRecipe, type RecipeImportDraft, type RecipeSaveInput } from "@/lib/recipes";
import { RecipeForm, newDraftLine, createDraftLineId } from "@/components/RecipeForm";
import { MAX_IMPORT_IMAGES, MAX_TOTAL_IMPORT_IMAGE_BYTES } from "@/lib/recipeImportLimits";
import { createId } from "@/lib/id";

const MAX_LONG_EDGE = 1600;
const JPEG_QUALITY = 0.8;

type Step = "choose" | "extracting" | "error" | "no-recipe" | "draft";

type SelectedImage = {
  id: string;
  file: File;
  previewUrl: string;
};

// Resizes/re-encodes a picked photo to JPEG using native Canvas APIs so a
// multi-megabyte phone photo isn't uploaded as-is. If the browser can't
// decode the source file, createImageBitmap throws — most likely for a
// format the browser has no built-in codec for — and the caller shows an
// error instead of silently uploading whatever was picked. Verified on iOS
// Safari and Brave against real camera photos; not assumed to cover every
// format a browser might hand back.
async function compressImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);

  try {
    const longEdge = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, MAX_LONG_EDGE / longEdge);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D context is not available.");
    }
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
    );
    if (!blob) {
      throw new Error("Could not encode the compressed image.");
    }

    return new File([blob], "recipe-photo.jpg", { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}

export default function ImportRecipePage() {
  const router = useRouter();

  const [step, setStep] = useState<Step>("choose");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<RecipeImportDraft | null>(null);
  const [images, setImages] = useState<SelectedImage[]>([]);

  // Guards against a second extraction request firing while one is already
  // in flight (e.g. a fast double-tap on Import) — same mutex shape as the
  // grocery grouping request on the groceries page.
  const isExtractingRef = useRef(false);
  const savedRecipeIdRef = useRef<string | null>(null);

  // Selected files are only ever held as in-memory object URLs for preview.
  // Individual removals revoke their own URL immediately (see removeImage);
  // this only handles the remaining case of navigating away with photos
  // still selected, via a ref so the cleanup always sees the latest list
  // rather than the one from the render that registered the effect.
  const imagesRef = useRef<SelectedImage[]>([]);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);
  useEffect(() => {
    return () => {
      imagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    };
  }, []);

  async function startExtraction(selected: SelectedImage[]) {
    if (isExtractingRef.current || selected.length === 0) {
      return;
    }
    isExtractingRef.current = true;
    setStep("extracting");
    setErrorMessage(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setStep("error");
        setErrorMessage("Your session has expired. Sign in again and retry.");
        return;
      }

      const body = new FormData();
      selected.forEach((image) => body.append("images", image.file));

      const response = await fetch("/api/import-recipe", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body,
      });

      const responseBody = await response.json().catch(() => null);

      if (!response.ok || !responseBody) {
        setStep("error");
        setErrorMessage(
          typeof responseBody?.error === "string"
            ? responseBody.error
            : "Couldn't extract a recipe from those photos. Try again."
        );
        return;
      }

      const importedDraft = responseBody as RecipeImportDraft;
      const hasContent =
        importedDraft.title !== null ||
        importedDraft.ingredients.length > 0 ||
        importedDraft.steps.length > 0;

      if (!hasContent) {
        setStep("no-recipe");
        return;
      }

      setDraft(importedDraft);
      setStep("draft");
    } catch (err) {
      console.error("Recipe import request failed:", err);
      setStep("error");
      setErrorMessage("Couldn't reach the server. Check your connection and try again.");
    } finally {
      isExtractingRef.current = false;
    }
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const pickedFiles = Array.from(event.target.files ?? []);
    // Reset so picking the same file(s) again still fires onChange.
    event.target.value = "";
    if (pickedFiles.length === 0) {
      return;
    }

    setErrorMessage(null);
    setStep("choose");
    setDraft(null);

    if (images.length + pickedFiles.length > MAX_IMPORT_IMAGES) {
      setErrorMessage(
        `You can import up to ${MAX_IMPORT_IMAGES} images at a time. ` +
          `You already have ${images.length} selected and picked ${pickedFiles.length} more — ` +
          `remove some first or pick fewer.`
      );
      return;
    }

    let compressed: File[];
    try {
      compressed = await Promise.all(pickedFiles.map((file) => compressImage(file)));
    } catch (err) {
      console.error("Image compression failed:", err);
      setErrorMessage("Couldn't process one of those photos on this device. Try a different photo.");
      return;
    }

    const totalBytes =
      images.reduce((sum, image) => sum + image.file.size, 0) +
      compressed.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_TOTAL_IMPORT_IMAGE_BYTES) {
      setErrorMessage("These photos are too large together. Remove one or try fewer/smaller photos.");
      return;
    }

    setImages((current) => [
      ...current,
      ...compressed.map((file) => ({ id: createId(), file, previewUrl: URL.createObjectURL(file) })),
    ]);
  }

  function removeImage(id: string) {
    setImages((current) => {
      const target = current.find((image) => image.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return current.filter((image) => image.id !== id);
    });
  }

  function moveImage(id: string, direction: -1 | 1) {
    setImages((current) => {
      const index = current.findIndex((image) => image.id === id);
      const targetIndex = index + direction;
      if (index === -1 || targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }
      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  }

  function handleImport() {
    startExtraction(images);
  }

  function handleRetry() {
    startExtraction(images);
  }

  async function handleSave(input: RecipeSaveInput): Promise<string | null> {
    const { id, error } = await createRecipe(input);
    if (error) {
      return error;
    }
    savedRecipeIdRef.current = id;
    return null;
  }

  function handleSaveSuccess() {
    router.push(`/recipes/${savedRecipeIdRef.current}`);
  }

  const isExtracting = step === "extracting";
  const atImageLimit = images.length >= MAX_IMPORT_IMAGES;

  return (
    <div className="flex flex-col gap-2 sm:gap-4">
      <div className="flex items-center gap-2">
        <Link
          href="/recipes"
          className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
        >
          &lsaquo; Recipes
        </Link>
        <h1 className="text-xl font-bold tracking-tight text-primary">Import from Photo</h1>
      </div>

      {step === "draft" && draft ? (
        <>
          {draft.warnings.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface-muted px-3.5 py-2.5">
              <span className="text-sm font-semibold text-foreground">Review before saving</span>
              <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                {draft.warnings.map((warning, index) => (
                  <li key={index}>&bull; {warning}</li>
                ))}
              </ul>
            </div>
          )}

          <RecipeForm
            initialTitle={draft.title ?? ""}
            initialSourceUrl=""
            initialNotes=""
            initialServings={draft.servings ?? ""}
            initialPrepTimeMinutes={draft.prepTimeMinutes}
            initialCookTimeMinutes={draft.cookTimeMinutes}
            initialTotalTimeMinutes={draft.totalTimeMinutes}
            initialIngredients={
              draft.ingredients.length > 0
                ? draft.ingredients.map((text) => ({ key: createDraftLineId(), text }))
                : [newDraftLine()]
            }
            initialSteps={
              draft.steps.length > 0
                ? draft.steps.map((text) => ({ key: createDraftLineId(), text }))
                : [newDraftLine()]
            }
            saveLabel="Save Recipe"
            onSave={handleSave}
            onSaveSuccess={handleSaveSuccess}
          />
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="p-1 text-sm text-muted-foreground">
            Select one or more screenshots of the <span className="font-medium">same recipe</span> — for
            example, scroll and screenshot in parts if a recipe is too long to fit in one screenshot.
            They&rsquo;ll be combined into a single recipe.
          </p>

          {step === "no-recipe" && (
            <p className="rounded-xl border border-border bg-surface-muted px-3.5 py-2.5 text-sm text-foreground">
              No recipe found in {images.length === 1 ? "that photo" : "those photos"}. Try clearer photos or
              different images.
            </p>
          )}

          {(step === "error" || step === "choose") && errorMessage && (
            <p className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
              {errorMessage}
            </p>
          )}

          {isExtracting ? (
            <p className="p-1 text-sm text-muted-foreground">
              {images.length === 1
                ? "Reading the photo…"
                : `Reading ${images.length} photos and combining them into one recipe…`}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {images.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {images.map((image, index) => (
                    <li
                      key={image.id}
                      className="flex items-center gap-3 rounded-xl border border-border bg-surface-muted px-2.5 py-2"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- transient client-side blob preview, not a served asset */}
                      <img
                        src={image.previewUrl}
                        alt={`Selected recipe photo ${index + 1}`}
                        className="h-14 w-14 shrink-0 rounded-lg object-cover"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        Photo {index + 1} of {images.length}
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveImage(image.id, -1)}
                          disabled={index === 0}
                          aria-label={`Move photo ${index + 1} earlier`}
                          className="flex min-h-9 min-w-9 items-center justify-center rounded-lg text-base text-muted-foreground transition hover:bg-surface hover:text-foreground disabled:opacity-30"
                        >
                          &uarr;
                        </button>
                        <button
                          type="button"
                          onClick={() => moveImage(image.id, 1)}
                          disabled={index === images.length - 1}
                          aria-label={`Move photo ${index + 1} later`}
                          className="flex min-h-9 min-w-9 items-center justify-center rounded-lg text-base text-muted-foreground transition hover:bg-surface hover:text-foreground disabled:opacity-30"
                        >
                          &darr;
                        </button>
                        <button
                          type="button"
                          onClick={() => removeImage(image.id)}
                          aria-label={`Remove photo ${index + 1}`}
                          className="flex min-h-9 min-w-9 items-center justify-center rounded-lg text-lg text-muted-foreground transition hover:bg-surface hover:text-danger"
                        >
                          &times;
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-col gap-2">
                <label
                  className={`flex min-h-11 items-center justify-center rounded-xl border border-border px-4 text-sm font-semibold text-foreground transition hover:bg-surface-muted ${
                    atImageLimit ? "pointer-events-none opacity-50" : "cursor-pointer"
                  }`}
                >
                  {images.length === 0
                    ? "Choose Photos"
                    : `Add More Photos (${images.length}/${MAX_IMPORT_IMAGES})`}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleFileChange}
                    disabled={atImageLimit}
                    aria-label="Choose recipe photos"
                    className="sr-only"
                  />
                </label>

                {images.length > 0 && (
                  <button
                    type="button"
                    onClick={handleImport}
                    className="min-h-11 rounded-xl bg-primary px-4 text-base font-medium text-primary-foreground transition hover:bg-primary/90 active:bg-primary/80"
                  >
                    {images.length === 1 ? "Import Photo" : `Import ${images.length} Photos as One Recipe`}
                  </button>
                )}

                {step === "error" && images.length > 0 && (
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="min-h-11 rounded-xl border border-border px-4 text-sm font-semibold text-foreground transition hover:bg-surface-muted"
                  >
                    Retry
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

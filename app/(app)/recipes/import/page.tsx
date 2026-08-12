"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { createRecipe, type RecipeImportDraft, type RecipeSaveInput } from "@/lib/recipes";
import { RecipeForm, newDraftLine, createDraftLineId } from "@/components/RecipeForm";

const MAX_LONG_EDGE = 1600;
const JPEG_QUALITY = 0.8;

type Step = "choose" | "extracting" | "error" | "no-recipe" | "draft";

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
  const [preparedFile, setPreparedFile] = useState<File | null>(null);

  // Guards against a second extraction request firing while one is already
  // in flight (e.g. a fast double-tap on Retry) — same mutex shape as the
  // grocery grouping request on the groceries page.
  const isExtractingRef = useRef(false);
  const savedRecipeIdRef = useRef<string | null>(null);

  async function startExtraction(file: File) {
    if (isExtractingRef.current) {
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
      body.append("image", file);

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
            : "Couldn't extract a recipe from that photo. Try again."
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
    const file = event.target.files?.[0];
    // Reset so picking the same file again still fires onChange.
    event.target.value = "";
    if (!file) {
      return;
    }

    setErrorMessage(null);
    setDraft(null);

    let compressed: File;
    try {
      compressed = await compressImage(file);
    } catch (err) {
      console.error("Image compression failed:", err);
      setPreparedFile(null);
      setStep("error");
      setErrorMessage("Couldn't process that photo on this device. Try a different photo.");
      return;
    }

    setPreparedFile(compressed);
    await startExtraction(compressed);
  }

  function handleRetry() {
    if (preparedFile) {
      startExtraction(preparedFile);
    }
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
          {step === "no-recipe" && (
            <p className="rounded-xl border border-border bg-surface-muted px-3.5 py-2.5 text-sm text-foreground">
              No recipe found in this photo. Try a clearer photo or a different image.
            </p>
          )}

          {step === "error" && errorMessage && (
            <p className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
              {errorMessage}
            </p>
          )}

          {isExtracting ? (
            <p className="p-1 text-sm text-muted-foreground">Reading the photo&hellip;</p>
          ) : (
            <div className="flex flex-col gap-2">
              <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-primary px-4 text-base font-medium text-primary-foreground transition hover:bg-primary/90 active:bg-primary/80">
                {step === "choose" ? "Choose Photo" : "Choose a Different Photo"}
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  aria-label="Choose a recipe photo"
                  className="sr-only"
                />
              </label>

              {step === "error" && preparedFile && (
                <button
                  type="button"
                  onClick={handleRetry}
                  className="min-h-11 rounded-xl border border-border px-4 text-sm font-semibold text-foreground transition hover:bg-surface-muted"
                >
                  Retry
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

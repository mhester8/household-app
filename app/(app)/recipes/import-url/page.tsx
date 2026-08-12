"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { createRecipe, type RecipeImportDraft, type RecipeSaveInput } from "@/lib/recipes";
import { RecipeForm, newDraftLine, createDraftLineId } from "@/components/RecipeForm";

type Step = "input" | "extracting" | "error" | "no-recipe" | "draft";

function isFetchableUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export default function ImportRecipeFromUrlPage() {
  const router = useRouter();

  const [step, setStep] = useState<Step>("input");
  const [url, setUrl] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<RecipeImportDraft | null>(null);

  // Guards against a second extraction request firing while one is already
  // in flight — same mutex shape as the photo importer's extraction guard.
  const isExtractingRef = useRef(false);
  const savedRecipeIdRef = useRef<string | null>(null);

  async function handleImport(event: React.FormEvent) {
    event.preventDefault();
    if (isExtractingRef.current) {
      return;
    }

    const trimmedUrl = url.trim();
    if (!isFetchableUrl(trimmedUrl)) {
      setStep("error");
      setErrorMessage("That doesn't look like a valid web address.");
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

      const response = await fetch("/api/import-recipe-url", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: trimmedUrl }),
      });

      const responseBody = await response.json().catch(() => null);

      if (!response.ok || !responseBody) {
        const reason = responseBody?.reason;
        setStep(reason === "no_structured_data" || reason === "unusable_structured_data" ? "no-recipe" : "error");
        setErrorMessage(
          typeof responseBody?.error === "string"
            ? responseBody.error
            : "Couldn't import a recipe from that page. Try again."
        );
        return;
      }

      setDraft(responseBody as RecipeImportDraft);
      setStep("draft");
    } catch (err) {
      console.error("URL recipe import request failed:", err);
      setStep("error");
      setErrorMessage("Couldn't reach the server. Check your connection and try again.");
    } finally {
      isExtractingRef.current = false;
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
        <h1 className="text-xl font-bold tracking-tight text-primary">Import from URL</h1>
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
            initialSourceUrl={draft.sourceUrl ?? url.trim()}
            initialNotes=""
            initialServings={draft.servings ?? ""}
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
          {step === "no-recipe" && errorMessage && (
            <p className="rounded-xl border border-border bg-surface-muted px-3.5 py-2.5 text-sm text-foreground">
              {errorMessage}
            </p>
          )}

          {step === "error" && errorMessage && (
            <p className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
              {errorMessage}
            </p>
          )}

          <form onSubmit={handleImport} className="flex flex-col gap-2">
            <input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/some-recipe"
              aria-label="Recipe URL"
              autoComplete="off"
              disabled={isExtracting}
              className="min-h-11 rounded-xl border border-border bg-surface-muted px-3.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isExtracting || url.trim() === ""}
              className="min-h-11 rounded-xl bg-primary px-4 text-base font-medium text-primary-foreground transition hover:bg-primary/90 active:bg-primary/80 disabled:opacity-50"
            >
              {isExtracting ? "Importing..." : "Import"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { createRecipe, type RecipeImportDraft, type RecipeSaveInput } from "@/lib/recipes";
import { RecipeForm, newDraftLine, createDraftLineId } from "@/components/RecipeForm";

type Step = "extracting" | "error" | "no-recipe" | "draft";

// Reached only via the Pinterest page's hand-off for a link-less Pin (see
// handleImportPinImage in app/(app)/pinterest/page.tsx) — there's no manual
// entry form here, unlike /recipes/import-url. Extraction starts
// automatically from the ?imageUrl=/&title=/&description=/&pinterestPinUrl=
// query params on mount.
export default function ImportRecipeFromPinPage() {
  const router = useRouter();

  const [step, setStep] = useState<Step>("extracting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<RecipeImportDraft | null>(null);
  // Set from ?pinterestPinUrl=; never shown or editable in RecipeForm — just
  // carried through to the save call, same as the URL importer's handling.
  const [pinterestPinUrl, setPinterestPinUrl] = useState<string | null>(null);

  const hasStartedRef = useRef(false);
  const savedRecipeIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (hasStartedRef.current) {
      return;
    }
    hasStartedRef.current = true;

    async function run() {
      const searchParams = new URLSearchParams(window.location.search);
      const imageUrl = searchParams.get("imageUrl");
      const title = searchParams.get("title");
      const description = searchParams.get("description");
      const paramPinterestPinUrl = searchParams.get("pinterestPinUrl");

      router.replace("/recipes/import-pin");

      if (paramPinterestPinUrl) {
        setPinterestPinUrl(paramPinterestPinUrl);
      }

      if (!imageUrl) {
        setStep("error");
        setErrorMessage("No Pin image to read.");
        return;
      }

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          setStep("error");
          setErrorMessage("Your session has expired. Sign in again and retry.");
          return;
        }

        const response = await fetch("/api/import-recipe-pin", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ imageUrl, title, description }),
        });

        const responseBody = await response.json().catch(() => null);

        if (!response.ok || !responseBody) {
          setStep("error");
          setErrorMessage(
            typeof responseBody?.error === "string"
              ? responseBody.error
              : "Couldn't read that Pin right now. Try again."
          );
          return;
        }

        const importedDraft = responseBody as RecipeImportDraft;
        const hasContent =
          importedDraft.title !== null || importedDraft.ingredients.length > 0 || importedDraft.steps.length > 0;

        if (!hasContent) {
          setStep("no-recipe");
          return;
        }

        setDraft(importedDraft);
        setStep("draft");
      } catch (err) {
        console.error("Pinterest Pin recipe import request failed:", err);
        setStep("error");
        setErrorMessage("Couldn't reach the server. Check your connection and try again.");
      }
    }

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave(input: RecipeSaveInput): Promise<string | null> {
    // RecipeForm has no image field of its own (Phase 2) — the draft's Pin
    // image is merged in here, at the one call site that has it, same as
    // the URL importer does with its JSON-LD-derived image.
    const { id, error } = await createRecipe(
      { ...input, imageUrl: draft?.imageUrl ?? null, pinterestPinUrl },
      "pinterest"
    );
    if (error) {
      return error;
    }
    savedRecipeIdRef.current = id;
    return null;
  }

  function handleSaveSuccess() {
    router.push(`/recipes/${savedRecipeIdRef.current}`);
  }

  return (
    <div className="flex flex-col gap-2 sm:gap-4">
      <div className="flex items-center gap-2">
        <Link
          href="/pinterest"
          className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
        >
          &lsaquo; Pinterest
        </Link>
        <h1 className="text-xl font-bold tracking-tight text-primary">Import from Pin</h1>
      </div>

      {step === "extracting" && <p className="p-1 text-sm text-muted-foreground">Reading the Pin&hellip;</p>}

      {step === "no-recipe" && (
        <p className="rounded-xl border border-border bg-surface-muted px-3.5 py-2.5 text-sm text-foreground">
          No importable recipe found in this Pin. It may just be a photo or title card rather than a written
          recipe.
        </p>
      )}

      {step === "error" && errorMessage && (
        <p className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
          {errorMessage}
        </p>
      )}

      {step === "draft" && draft && (
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
      )}
    </div>
  );
}

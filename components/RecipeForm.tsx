"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RecipeSaveInput } from "@/lib/recipes";
import { hoursMinutesToTotalMinutes, totalMinutesToHoursMinutesStrings } from "@/lib/recipeTime";

export type { RecipeSaveInput } from "@/lib/recipes";

export type RecipeDraftLine = {
  key: string;
  text: string;
};

// crypto.randomUUID() is unavailable on some mobile browsers (seen on iOS
// Safari and Brave) even though `crypto` itself exists. These ids are only
// ever used as React keys/local form state for draft rows — never
// persisted as a recipe/database id — so a timestamp + random suffix is a
// fine collision-resistant fallback.
export function createDraftLineId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function newDraftLine(): RecipeDraftLine {
  return { key: createDraftLineId(), text: "" };
}

// Shared by /recipes/new and /recipes/[id]/edit — same fields and validation,
// the only difference is what onSave does with the result (insert vs.
// update + replace children), same split as TemplateForm/workouts.
export function RecipeForm({
  initialTitle,
  initialSourceUrl,
  initialNotes,
  initialServings,
  initialPrepTimeMinutes,
  initialCookTimeMinutes,
  initialTotalTimeMinutes,
  initialIngredients,
  initialSteps,
  saveLabel,
  onSave,
  onSaveSuccess,
}: {
  initialTitle: string;
  initialSourceUrl: string;
  initialNotes: string;
  initialServings: string;
  initialPrepTimeMinutes: number | null;
  initialCookTimeMinutes: number | null;
  initialTotalTimeMinutes: number | null;
  initialIngredients: RecipeDraftLine[];
  initialSteps: RecipeDraftLine[];
  saveLabel: string;
  onSave: (input: RecipeSaveInput) => Promise<string | null>;
  // Called instead of the default redirect to /recipes when the caller wants
  // to send the user somewhere else after a successful save (the photo
  // importer sends them to the new recipe's detail page). Omit to keep the
  // existing /recipes redirect used by the manual create/edit flows.
  onSaveSuccess?: () => void;
}) {
  const router = useRouter();

  const [title, setTitle] = useState(initialTitle);
  const [sourceUrl, setSourceUrl] = useState(initialSourceUrl);
  const [notes, setNotes] = useState(initialNotes);
  const [servings, setServings] = useState(initialServings);

  const initialPrep = totalMinutesToHoursMinutesStrings(initialPrepTimeMinutes);
  const initialCook = totalMinutesToHoursMinutesStrings(initialCookTimeMinutes);
  const initialTotal = totalMinutesToHoursMinutesStrings(initialTotalTimeMinutes);
  const [prepHours, setPrepHours] = useState(initialPrep.hours);
  const [prepMinutes, setPrepMinutes] = useState(initialPrep.minutes);
  const [cookHours, setCookHours] = useState(initialCook.hours);
  const [cookMinutes, setCookMinutes] = useState(initialCook.minutes);
  const [totalHours, setTotalHours] = useState(initialTotal.hours);
  const [totalMinutes, setTotalMinutes] = useState(initialTotal.minutes);

  const [ingredients, setIngredients] = useState<RecipeDraftLine[]>(initialIngredients);
  const [steps, setSteps] = useState<RecipeDraftLine[]>(initialSteps);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const timeRows = [
    { label: "Prep time", hours: prepHours, setHours: setPrepHours, minutes: prepMinutes, setMinutes: setPrepMinutes },
    { label: "Cook time", hours: cookHours, setHours: setCookHours, minutes: cookMinutes, setMinutes: setCookMinutes },
    { label: "Total time", hours: totalHours, setHours: setTotalHours, minutes: totalMinutes, setMinutes: setTotalMinutes },
  ];

  function updateIngredient(key: string, text: string) {
    setIngredients((current) => current.map((line) => (line.key === key ? { ...line, text } : line)));
  }

  function removeIngredient(key: string) {
    setIngredients((current) => current.filter((line) => line.key !== key));
  }

  function updateStep(key: string, text: string) {
    setSteps((current) => current.map((line) => (line.key === key ? { ...line, text } : line)));
  }

  function removeStep(key: string) {
    setSteps((current) => current.filter((line) => line.key !== key));
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage(null);

    const trimmedTitle = title.trim();
    const trimmedSourceUrl = sourceUrl.trim();
    const trimmedNotes = notes.trim();
    const trimmedServings = servings.trim();
    const trimmedIngredients = ingredients.map((line) => line.text.trim()).filter((text) => text !== "");
    const trimmedSteps = steps.map((line) => line.text.trim()).filter((text) => text !== "");

    if (trimmedTitle === "") {
      setErrorMessage("Give this recipe a title.");
      return;
    }

    const prep = hoursMinutesToTotalMinutes(prepHours, prepMinutes);
    const cook = hoursMinutesToTotalMinutes(cookHours, cookMinutes);
    const total = hoursMinutesToTotalMinutes(totalHours, totalMinutes);
    const timeError = prep.error ?? cook.error ?? total.error;
    if (timeError) {
      setErrorMessage(timeError);
      return;
    }

    setIsSaving(true);

    const error = await onSave({
      title: trimmedTitle,
      sourceUrl: trimmedSourceUrl === "" ? null : trimmedSourceUrl,
      notes: trimmedNotes === "" ? null : trimmedNotes,
      servings: trimmedServings === "" ? null : trimmedServings,
      prepTimeMinutes: prep.minutes,
      cookTimeMinutes: cook.minutes,
      totalTimeMinutes: total.minutes,
      ingredients: trimmedIngredients,
      steps: trimmedSteps,
    });

    if (error) {
      setErrorMessage(error);
      setIsSaving(false);
      return;
    }

    if (onSaveSuccess) {
      onSaveSuccess();
    } else {
      router.push("/recipes");
    }
  }

  return (
    <>
      {errorMessage && (
        <p className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
          {errorMessage}
        </p>
      )}

      <form onSubmit={handleSave} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="recipe-title" className="px-1 text-xs font-medium text-muted-foreground">
            Title
          </label>
          <input
            id="recipe-title"
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Recipe title"
            autoComplete="off"
            className="min-h-11 rounded-xl border border-border bg-surface-muted px-3.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="recipe-servings" className="px-1 text-xs font-medium text-muted-foreground">
            Servings / Yield
          </label>
          <input
            id="recipe-servings"
            type="text"
            value={servings}
            onChange={(event) => setServings(event.target.value)}
            placeholder="Optional, e.g. Serves 6"
            autoComplete="off"
            className="min-h-11 rounded-xl border border-border bg-surface-muted px-3.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-foreground">Time (optional)</span>
          <div className="flex flex-col gap-2">
            {timeRows.map((row) => (
              <div key={row.label} className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-sm text-muted-foreground">{row.label}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={row.hours}
                  onChange={(event) => row.setHours(event.target.value)}
                  placeholder="0"
                  aria-label={`${row.label}, hours`}
                  className="min-h-11 w-16 min-w-0 rounded-xl border border-border bg-surface-muted px-2.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <span className="text-sm text-muted-foreground">hr</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={row.minutes}
                  onChange={(event) => row.setMinutes(event.target.value)}
                  placeholder="0"
                  aria-label={`${row.label}, minutes`}
                  className="min-h-11 w-16 min-w-0 rounded-xl border border-border bg-surface-muted px-2.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <span className="text-sm text-muted-foreground">min</span>
              </div>
            ))}
          </div>
        </div>

        <input
          type="url"
          value={sourceUrl}
          onChange={(event) => setSourceUrl(event.target.value)}
          placeholder="Source URL (optional)"
          aria-label="Source URL"
          autoComplete="off"
          className="min-h-11 rounded-xl border border-border bg-surface-muted px-3.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />

        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Notes (optional)"
          aria-label="Notes"
          rows={3}
          className="min-h-20 rounded-xl border border-border bg-surface-muted px-3.5 py-2.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />

        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-foreground">Ingredients</span>
          <div className="flex flex-col gap-2">
            {ingredients.map((line, index) => (
              <div key={line.key} className="flex items-center gap-2">
                <input
                  type="text"
                  value={line.text}
                  onChange={(event) => updateIngredient(line.key, event.target.value)}
                  placeholder="e.g. 2 tbsp olive oil"
                  aria-label={`Ingredient ${index + 1}`}
                  autoComplete="off"
                  className="min-h-11 min-w-0 flex-1 rounded-xl border border-border bg-surface-muted px-3.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={() => removeIngredient(line.key)}
                  aria-label={`Remove ingredient ${index + 1}`}
                  className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-lg text-muted-foreground transition hover:bg-surface-muted hover:text-danger"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setIngredients((current) => [...current, newDraftLine()])}
            className="min-h-11 rounded-xl border border-dashed border-border px-4 text-sm font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
          >
            + Add Ingredient
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-foreground">Steps</span>
          <div className="flex flex-col gap-2">
            {steps.map((line, index) => (
              <div key={line.key} className="flex items-start gap-2">
                <span className="mt-2.5 shrink-0 text-sm font-semibold text-muted-foreground">
                  {index + 1}.
                </span>
                <textarea
                  value={line.text}
                  onChange={(event) => updateStep(line.key, event.target.value)}
                  placeholder={`Step ${index + 1}`}
                  aria-label={`Step ${index + 1}`}
                  rows={2}
                  className="min-h-11 min-w-0 flex-1 rounded-xl border border-border bg-surface-muted px-3.5 py-2.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={() => removeStep(line.key)}
                  aria-label={`Remove step ${index + 1}`}
                  className="mt-1 flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-lg text-muted-foreground transition hover:bg-surface-muted hover:text-danger"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setSteps((current) => [...current, newDraftLine()])}
            className="min-h-11 rounded-xl border border-dashed border-border px-4 text-sm font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
          >
            + Add Step
          </button>
        </div>

        <button
          type="submit"
          disabled={isSaving}
          className="min-h-11 rounded-xl bg-primary px-4 text-base font-medium text-primary-foreground transition hover:bg-primary/90 active:bg-primary/80 disabled:opacity-50"
        >
          {isSaving ? "Saving..." : saveLabel}
        </button>
      </form>
    </>
  );
}

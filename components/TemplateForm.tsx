"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDuration, parseRestDuration } from "@/lib/workouts";

const DEFAULT_SETS = 3;
const DEFAULT_REST_SECONDS = 60;

export type TemplateDraftExercise = {
  key: string;
  name: string;
  sets: string;
  restSeconds: string;
};

export function newDraftExercise(): TemplateDraftExercise {
  return {
    key: crypto.randomUUID(),
    name: "",
    sets: String(DEFAULT_SETS),
    restSeconds: formatDuration(DEFAULT_REST_SECONDS),
  };
}

export type TemplateSaveInput = {
  name: string;
  exercises: { name: string; sets: number; rest_seconds: number }[];
};

// Shared by /workouts/new and /workouts/[id]/edit — same fields, same
// validation, same rest-duration parsing either way. The only difference
// between create and edit is what onSave actually does with the result.
export function TemplateForm({
  initialName,
  initialExercises,
  saveLabel,
  onSave,
}: {
  initialName: string;
  initialExercises: TemplateDraftExercise[];
  saveLabel: string;
  onSave: (input: TemplateSaveInput) => Promise<string | null>;
}) {
  const router = useRouter();

  const [templateName, setTemplateName] = useState(initialName);
  const [exercises, setExercises] = useState<TemplateDraftExercise[]>(initialExercises);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function updateExercise(key: string, patch: Partial<TemplateDraftExercise>) {
    setExercises((current) =>
      current.map((exercise) => (exercise.key === key ? { ...exercise, ...patch } : exercise))
    );
  }

  function addExercise() {
    setExercises((current) => [...current, newDraftExercise()]);
  }

  function removeExercise(key: string) {
    setExercises((current) => current.filter((exercise) => exercise.key !== key));
  }

  // Reformats a valid rest entry to m:ss on blur (e.g. "90" -> "1:30") so the
  // field always shows what was actually understood. Invalid entries are left
  // as typed — handleSave's validation will explain the problem.
  function handleRestBlur(key: string, rawValue: string) {
    const seconds = parseRestDuration(rawValue);
    if (seconds !== null) {
      updateExercise(key, { restSeconds: formatDuration(seconds) });
    }
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage(null);

    const trimmedName = templateName.trim();
    const trimmedExercises = exercises
      .map((exercise) => ({ ...exercise, name: exercise.name.trim() }))
      .filter((exercise) => exercise.name !== "");

    if (trimmedName === "") {
      setErrorMessage("Give this template a name.");
      return;
    }
    if (trimmedExercises.length === 0) {
      setErrorMessage("Add at least one exercise.");
      return;
    }
    for (const exercise of trimmedExercises) {
      const sets = Number(exercise.sets);
      const restSeconds = parseRestDuration(exercise.restSeconds);
      if (!Number.isInteger(sets) || sets < 1) {
        setErrorMessage(`${exercise.name}: sets must be a whole number of at least 1.`);
        return;
      }
      if (restSeconds === null) {
        setErrorMessage(`${exercise.name}: rest must be like 60 or 1:30.`);
        return;
      }
    }

    setIsSaving(true);

    const error = await onSave({
      name: trimmedName,
      exercises: trimmedExercises.map((exercise) => ({
        name: exercise.name,
        sets: Number(exercise.sets),
        rest_seconds: parseRestDuration(exercise.restSeconds) ?? 0,
      })),
    });

    if (error) {
      setErrorMessage(error);
      setIsSaving(false);
      return;
    }

    router.push("/workouts");
  }

  return (
    <>
      {errorMessage && (
        <p className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
          {errorMessage}
        </p>
      )}

      <form onSubmit={handleSave} className="flex flex-col gap-4">
        <input
          type="text"
          value={templateName}
          onChange={(event) => setTemplateName(event.target.value)}
          placeholder="Template name"
          aria-label="Template name"
          autoComplete="off"
          className="min-h-11 rounded-xl border border-border bg-surface-muted px-3.5 text-base uppercase text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />

        <div className="flex flex-col gap-3">
          {exercises.map((exercise, index) => (
            <div
              key={exercise.key}
              className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
            >
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={exercise.name}
                  onChange={(event) => updateExercise(exercise.key, { name: event.target.value })}
                  placeholder={`Exercise ${index + 1} name`}
                  aria-label={`Exercise ${index + 1} name`}
                  autoComplete="off"
                  className="min-h-11 min-w-0 flex-1 rounded-xl border border-border bg-surface-muted px-3.5 text-base uppercase text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={() => removeExercise(exercise.key)}
                  aria-label={`Remove ${exercise.name || `exercise ${index + 1}`}`}
                  className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-lg text-muted-foreground transition hover:bg-surface-muted hover:text-danger"
                >
                  &times;
                </button>
              </div>
              <div className="flex gap-2">
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">Sets</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={exercise.sets}
                    onChange={(event) => updateExercise(exercise.key, { sets: event.target.value })}
                    aria-label={`${exercise.name || `Exercise ${index + 1}`} sets`}
                    className="min-h-11 rounded-xl border border-border bg-surface-muted px-3.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">Rest</span>
                  <input
                    type="text"
                    value={exercise.restSeconds}
                    onChange={(event) =>
                      updateExercise(exercise.key, { restSeconds: event.target.value })
                    }
                    onBlur={(event) => handleRestBlur(exercise.key, event.target.value)}
                    placeholder="1:30"
                    aria-label={`${exercise.name || `Exercise ${index + 1}`} rest duration`}
                    className="min-h-11 rounded-xl border border-border bg-surface-muted px-3.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addExercise}
          className="min-h-11 rounded-xl border border-dashed border-border px-4 text-sm font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
        >
          + Add Exercise
        </button>

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

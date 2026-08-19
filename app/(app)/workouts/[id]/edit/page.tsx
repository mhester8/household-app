"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { formatDuration } from "@/lib/workouts";
import { TemplateForm, type TemplateDraftExercise, type TemplateSaveInput } from "@/components/TemplateForm";
import { createId } from "@/lib/id";

export default function EditTemplatePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const templateId = params.id;

  const [templateName, setTemplateName] = useState<string | null>(null);
  const [exercises, setExercises] = useState<TemplateDraftExercise[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function loadTemplate() {
    setIsLoading(true);
    setLoadError(null);

    const { data: template, error: templateError } = await supabase
      .from("workout_templates")
      .select("id, name")
      .eq("id", templateId)
      .maybeSingle();

    if (templateError || !template) {
      setLoadError(templateError ? templateError.message : "Template not found.");
      setIsLoading(false);
      return;
    }

    const { data: exerciseRows, error: exercisesError } = await supabase
      .from("template_exercises")
      .select("name, sets, rest_seconds")
      .eq("template_id", templateId)
      .order("position", { ascending: true });

    if (exercisesError) {
      setLoadError(exercisesError.message);
      setIsLoading(false);
      return;
    }

    setTemplateName(template.name);
    setExercises(
      (exerciseRows ?? []).map((exercise) => ({
        key: createId(),
        name: exercise.name,
        sets: String(exercise.sets),
        restSeconds: formatDuration(exercise.rest_seconds),
      }))
    );
    setIsLoading(false);
  }

  useEffect(() => {
    function runInitialLoad() {
      loadTemplate();
    }
    runInitialLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  // template_exercises rows aren't referenced by anything else — a session's
  // session_exercises are a snapshot copied at start time, not a foreign key
  // into this table — so replacing the whole set here can't touch an
  // already-started session.
  async function handleSave(input: TemplateSaveInput): Promise<string | null> {
    const { error: templateError } = await supabase
      .from("workout_templates")
      .update({ name: input.name })
      .eq("id", templateId);

    if (templateError) {
      return `Couldn't save template: ${templateError.message}`;
    }

    const { error: deleteError } = await supabase
      .from("template_exercises")
      .delete()
      .eq("template_id", templateId);

    if (deleteError) {
      return `Couldn't save template: ${deleteError.message}`;
    }

    const { error: insertError } = await supabase.from("template_exercises").insert(
      input.exercises.map((exercise, index) => ({
        template_id: templateId,
        position: index,
        name: exercise.name,
        sets: exercise.sets,
        rest_seconds: exercise.rest_seconds,
      }))
    );

    if (insertError) {
      return `Couldn't save template: ${insertError.message}`;
    }

    return null;
  }

  // Deletion is defensive about a workout_sessions -> workout_templates
  // foreign key we can't see from this repo (schema is Supabase-dashboard-
  // managed): template_id is detached from any past sessions first. That's
  // always safe regardless of whether such a constraint exists, because
  // session_exercises are snapshotted at session start (decision 005) and
  // the session page never reads template_id back for display — only
  // session.name and session_exercises drive what's shown.
  async function handleDeleteTemplate() {
    setIsDeleting(true);
    setDeleteError(null);

    const { error: detachError } = await supabase
      .from("workout_sessions")
      .update({ template_id: null })
      .eq("template_id", templateId);

    if (detachError) {
      setDeleteError(`Couldn't delete template: ${detachError.message}`);
      setIsDeleting(false);
      return;
    }

    const { error: exercisesError } = await supabase
      .from("template_exercises")
      .delete()
      .eq("template_id", templateId);

    if (exercisesError) {
      setDeleteError(`Couldn't delete template: ${exercisesError.message}`);
      setIsDeleting(false);
      return;
    }

    const { error: templateError } = await supabase
      .from("workout_templates")
      .delete()
      .eq("id", templateId);

    if (templateError) {
      setDeleteError(`Couldn't delete template: ${templateError.message}`);
      setIsDeleting(false);
      return;
    }

    router.push("/workouts");
  }

  return (
    <div className="flex flex-col gap-2 sm:gap-4">
      <div className="flex items-center gap-2">
        <Link
          href="/workouts"
          className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
        >
          &lsaquo; Workouts
        </Link>
        <h1 className="text-xl font-bold tracking-tight text-primary">Edit Template</h1>
      </div>

      {isLoading ? (
        <p className="p-1 text-sm text-muted-foreground">Loading template...</p>
      ) : loadError || templateName === null || exercises === null ? (
        <p className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
          {loadError ?? "Template not found."}
        </p>
      ) : (
        <>
          <TemplateForm
            initialName={templateName}
            initialExercises={exercises}
            saveLabel="Save Changes"
            onSave={handleSave}
          />

          {deleteError && (
            <p className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
              {deleteError}
            </p>
          )}

          {isConfirmingDelete ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-danger/30 bg-surface p-4">
              <span className="text-sm text-foreground">
                Delete <span className="font-semibold">{templateName}</span>? This can&rsquo;t be undone.
                Past workout sessions logged from this template are unaffected.
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsConfirmingDelete(false)}
                  disabled={isDeleting}
                  className="min-h-11 flex-1 rounded-xl bg-surface-muted px-4 text-sm font-semibold text-foreground transition hover:bg-border disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteTemplate}
                  disabled={isDeleting}
                  className="min-h-11 flex-1 rounded-xl bg-danger px-4 text-sm font-semibold text-primary-foreground transition hover:bg-danger/90 disabled:opacity-50"
                >
                  {isDeleting ? "Deleting..." : "Delete Template"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsConfirmingDelete(true)}
              className="min-h-11 rounded-xl px-4 text-sm font-semibold text-danger transition hover:bg-danger/10"
            >
              Delete Template
            </button>
          )}
        </>
      )}
    </div>
  );
}

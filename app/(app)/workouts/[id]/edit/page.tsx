"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { formatDuration } from "@/lib/workouts";
import { TemplateForm, type TemplateDraftExercise, type TemplateSaveInput } from "@/components/TemplateForm";

export default function EditTemplatePage() {
  const params = useParams<{ id: string }>();
  const templateId = params.id;

  const [templateName, setTemplateName] = useState<string | null>(null);
  const [exercises, setExercises] = useState<TemplateDraftExercise[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

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
        key: crypto.randomUUID(),
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
        <TemplateForm
          initialName={templateName}
          initialExercises={exercises}
          saveLabel="Save Changes"
          onSave={handleSave}
        />
      )}
    </div>
  );
}

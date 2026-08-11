"use client";

import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { TemplateForm, newDraftExercise, type TemplateSaveInput } from "@/components/TemplateForm";

export default function NewTemplatePage() {
  async function handleSave(input: TemplateSaveInput): Promise<string | null> {
    const { data: template, error: templateError } = await supabase
      .from("workout_templates")
      .insert({ name: input.name })
      .select("id")
      .single();

    if (templateError || !template) {
      return `Couldn't save template: ${templateError?.message ?? "unknown error"}`;
    }

    const { error: exercisesError } = await supabase.from("template_exercises").insert(
      input.exercises.map((exercise, index) => ({
        template_id: template.id,
        position: index,
        name: exercise.name,
        sets: exercise.sets,
        rest_seconds: exercise.rest_seconds,
      }))
    );

    if (exercisesError) {
      await supabase.from("workout_templates").delete().eq("id", template.id);
      return `Couldn't save template: ${exercisesError.message}`;
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
        <h1 className="text-xl font-bold tracking-tight text-primary">New Template</h1>
      </div>

      <TemplateForm
        initialName=""
        initialExercises={[newDraftExercise()]}
        saveLabel="Save Template"
        onSave={handleSave}
      />
    </div>
  );
}

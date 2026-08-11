"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import type { WorkoutTemplate } from "@/lib/workouts";

type TemplateWithCount = WorkoutTemplate & { exerciseCount: number };

type ActiveSession = {
  id: string;
  name: string;
  started_at: string;
};

// Which confirmation panel (if any) is showing in place of the normal
// active-session banner. "conflict" holds the template the user actually
// tapped Start on, so Cancel & Start can proceed to it afterward.
type ConfirmState = { kind: "cancel-active" } | { kind: "conflict"; template: TemplateWithCount };

export default function WorkoutsPage() {
  const router = useRouter();

  const [templates, setTemplates] = useState<TemplateWithCount[]>([]);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [startingTemplateId, setStartingTemplateId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  async function loadData() {
    setIsLoading(true);
    setErrorMessage(null);

    const [templatesResult, exercisesResult, sessionResult] = await Promise.all([
      supabase
        .from("workout_templates")
        .select("id, name, created_at")
        .order("created_at", { ascending: true }),
      supabase.from("template_exercises").select("template_id"),
      supabase
        .from("workout_sessions")
        .select("id, name, started_at")
        .is("completed_at", null)
        .maybeSingle(),
    ]);

    if (templatesResult.error || exercisesResult.error) {
      setErrorMessage(
        `Could not load workout templates: ${
          templatesResult.error?.message ?? exercisesResult.error?.message
        }`
      );
      setIsLoading(false);
      return;
    }

    const countByTemplateId = new Map<string, number>();
    for (const row of exercisesResult.data ?? []) {
      countByTemplateId.set(row.template_id, (countByTemplateId.get(row.template_id) ?? 0) + 1);
    }

    setTemplates(
      (templatesResult.data ?? []).map((template) => ({
        ...template,
        exerciseCount: countByTemplateId.get(template.id) ?? 0,
      }))
    );
    setActiveSession(sessionResult.data ?? null);
    setIsLoading(false);
  }

  useEffect(() => {
    function runInitialLoad() {
      loadData();
    }
    runInitialLoad();
  }, []);

  // Creates the session + snapshot exercises for a template that we've
  // already confirmed is safe to start (no active session in the way).
  async function startTemplate(template: TemplateWithCount) {
    setErrorMessage(null);
    setStartingTemplateId(template.id);

    const { data: exercises, error: exercisesError } = await supabase
      .from("template_exercises")
      .select("name, position, sets, rest_seconds")
      .eq("template_id", template.id)
      .order("position", { ascending: true });

    if (exercisesError || !exercises || exercises.length === 0) {
      setErrorMessage("Couldn't start workout: this template has no exercises.");
      setStartingTemplateId(null);
      return;
    }

    const { data: session, error: sessionError } = await supabase
      .from("workout_sessions")
      .insert({ template_id: template.id, name: template.name })
      .select("id")
      .single();

    if (sessionError || !session) {
      setErrorMessage(`Couldn't start workout: ${sessionError?.message ?? "unknown error"}`);
      setStartingTemplateId(null);
      return;
    }

    const { error: sessionExercisesError } = await supabase.from("session_exercises").insert(
      exercises.map((exercise) => ({
        session_id: session.id,
        position: exercise.position,
        name: exercise.name,
        sets: exercise.sets,
        rest_seconds: exercise.rest_seconds,
      }))
    );

    if (sessionExercisesError) {
      await supabase.from("workout_sessions").delete().eq("id", session.id);
      setErrorMessage(`Couldn't start workout: ${sessionExercisesError.message}`);
      setStartingTemplateId(null);
      return;
    }

    router.push(`/workouts/session/${session.id}`);
  }

  // Starting never silently opens whatever session is already active — it
  // re-checks first and asks instead.
  async function handleStart(template: TemplateWithCount) {
    setErrorMessage(null);
    setStartingTemplateId(template.id);

    const { data: existing } = await supabase
      .from("workout_sessions")
      .select("id, name, started_at")
      .is("completed_at", null)
      .maybeSingle();

    setStartingTemplateId(null);

    if (existing) {
      setActiveSession(existing);
      setConfirmState({ kind: "conflict", template });
      return;
    }

    await startTemplate(template);
  }

  // Deletes the active session (session_exercises/session_sets cascade via
  // their existing FKs) without weakening the one-active-session unique
  // index — this always runs to completion before any new session is
  // inserted, so there's never a moment with two incomplete sessions.
  async function cancelActiveSession(): Promise<boolean> {
    if (!activeSession) {
      return false;
    }
    setIsCancelling(true);
    setErrorMessage(null);

    const { error } = await supabase.from("workout_sessions").delete().eq("id", activeSession.id);

    setIsCancelling(false);

    if (error) {
      setErrorMessage(`Couldn't cancel workout: ${error.message}`);
      return false;
    }

    setActiveSession(null);
    return true;
  }

  async function handleConfirmCancelActive() {
    const cancelled = await cancelActiveSession();
    if (cancelled) {
      setConfirmState(null);
    }
  }

  async function handleCancelAndStart(template: TemplateWithCount) {
    const cancelled = await cancelActiveSession();
    if (!cancelled) {
      return;
    }
    setConfirmState(null);
    await startTemplate(template);
  }

  function renderActiveSessionArea() {
    if (confirmState?.kind === "cancel-active" && activeSession) {
      return (
        <div className="flex flex-col gap-3 rounded-2xl border border-danger/30 bg-surface p-4">
          <div className="flex flex-col gap-1">
            <span className="text-base font-semibold text-foreground">Cancel this workout?</span>
            <span className="text-sm text-muted-foreground">
              This will remove the unfinished{" "}
              <span className="uppercase">{activeSession.name}</span> and its logged sets.
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmState(null)}
              disabled={isCancelling}
              className="min-h-11 flex-1 rounded-xl bg-surface-muted px-4 text-sm font-semibold text-foreground transition hover:bg-border disabled:opacity-50"
            >
              Keep Workout
            </button>
            <button
              type="button"
              onClick={handleConfirmCancelActive}
              disabled={isCancelling}
              className="min-h-11 flex-1 rounded-xl bg-danger px-4 text-sm font-semibold text-primary-foreground transition hover:bg-danger/90 disabled:opacity-50"
            >
              {isCancelling ? "Cancelling..." : "Cancel Workout"}
            </button>
          </div>
        </div>
      );
    }

    if (confirmState?.kind === "conflict" && activeSession) {
      const { template } = confirmState;
      return (
        <div className="flex flex-col gap-3 rounded-2xl border border-danger/30 bg-surface p-4">
          <div className="flex flex-col gap-1">
            <span className="text-base font-semibold text-foreground">Workout already in progress</span>
            <span className="text-sm text-muted-foreground">
              <span className="uppercase">{activeSession.name}</span> is currently in progress. To
              start <span className="uppercase">{template.name}</span>, you&rsquo;ll need to cancel
              the current workout.
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <Link
              href={`/workouts/session/${activeSession.id}`}
              className="min-h-11 flex items-center justify-center rounded-xl bg-surface-muted px-4 text-sm font-semibold text-foreground transition hover:bg-border"
            >
              Resume <span className="uppercase">{activeSession.name}</span>
            </Link>
            <button
              type="button"
              onClick={() => handleCancelAndStart(template)}
              disabled={isCancelling}
              className="min-h-11 rounded-xl bg-danger px-4 text-sm font-semibold text-primary-foreground transition hover:bg-danger/90 disabled:opacity-50"
            >
              {isCancelling ? (
                "Cancelling..."
              ) : (
                <>
                  Cancel &amp; Start <span className="uppercase">{template.name}</span>
                </>
              )}
            </button>
          </div>
        </div>
      );
    }

    if (!activeSession) {
      return null;
    }

    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-primary/40 bg-primary/10 px-4 py-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-primary">
            In progress
          </span>
          <span className="text-base font-semibold uppercase text-foreground">{activeSession.name}</span>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/workouts/session/${activeSession.id}`}
            className="min-h-11 flex flex-1 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
          >
            Resume
          </Link>
          <button
            type="button"
            onClick={() => setConfirmState({ kind: "cancel-active" })}
            className="min-h-11 flex-1 rounded-xl bg-surface-muted px-4 text-sm font-semibold text-foreground transition hover:bg-border"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 sm:gap-4">
      <div className="flex items-center gap-2">
        <Link
          href="/"
          className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
        >
          &lsaquo; Home
        </Link>
        <h1 className="text-xl font-bold tracking-tight text-primary">Workouts</h1>
      </div>

      {errorMessage && (
        <p className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
          {errorMessage}
        </p>
      )}

      {isLoading ? (
        <p className="p-1 text-sm text-muted-foreground">Loading templates...</p>
      ) : (
        <>
          {renderActiveSessionArea()}

          <Link
            href="/workouts/new"
            className="min-h-11 flex items-center justify-center rounded-xl bg-primary px-4 text-base font-medium text-primary-foreground transition hover:bg-primary/90 active:bg-primary/80"
          >
            + New Template
          </Link>

          <ul className="flex flex-col divide-y divide-border sm:rounded-2xl sm:border sm:border-border">
            {templates.map((template) => (
              <li key={template.id} className="flex items-center justify-between gap-2 px-1.5 py-2">
                <div className="flex min-w-0 flex-col gap-0.5 px-1">
                  <span className="truncate text-[15px] font-medium uppercase text-foreground">
                    {template.name}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {template.exerciseCount} exercise{template.exerciseCount === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Link
                    href={`/workouts/${template.id}/edit`}
                    className="flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
                  >
                    Edit
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleStart(template)}
                    disabled={startingTemplateId !== null}
                    className="min-h-11 rounded-xl bg-surface-muted px-4 text-sm font-semibold text-primary transition hover:bg-border disabled:opacity-50"
                  >
                    {startingTemplateId === template.id ? "Starting..." : "Start"}
                  </button>
                </div>
              </li>
            ))}
            {templates.length === 0 && (
              <li className="px-1 py-6 text-center text-sm text-muted-foreground">
                No templates yet. Create one to get started.
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}

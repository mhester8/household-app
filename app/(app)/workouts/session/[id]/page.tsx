"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import {
  getLastCompletedSet,
  getNextProgress,
  getRestEndAt,
  getSessionProgress,
  type SessionExercise,
  type SessionProgress,
  type SessionSet,
  type WorkoutSession,
} from "@/lib/workouts";
import { RestTimer } from "@/components/RestTimer";

// "Up next" copy stays normal case; only the exercise name itself renders
// uppercase (display-only — the underlying exercise.name is never touched).
function UpNextLabel({ progress }: { progress: SessionProgress }) {
  if (progress.status === "complete") {
    return <>Finish workout</>;
  }
  return (
    <>
      Set {progress.setNumber} of {progress.exercise.sets} &middot;{" "}
      <span className="uppercase">{progress.exercise.name}</span>
    </>
  );
}

export default function WorkoutSessionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const sessionId = params.id;

  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [exercises, setExercises] = useState<SessionExercise[]>([]);
  const [sets, setSets] = useState<SessionSet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [weightInput, setWeightInput] = useState("");
  const [repsInput, setRepsInput] = useState("");
  const [isLoggingSet, setIsLoggingSet] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);

  // Locally marks the most recently completed set's rest as "acknowledged"
  // so the countdown stops being shown. Deliberately not persisted: a
  // refresh simply re-derives whether rest time has actually elapsed from
  // completed_at + rest_seconds, which is the source of truth either way.
  const [dismissedSetId, setDismissedSetId] = useState<string | null>(null);

  async function loadSession() {
    setIsLoading(true);
    setErrorMessage(null);

    const { data: sessionData, error: sessionError } = await supabase
      .from("workout_sessions")
      .select("id, template_id, name, started_at, completed_at")
      .eq("id", sessionId)
      .maybeSingle();

    if (sessionError || !sessionData) {
      setErrorMessage(sessionError ? sessionError.message : "Workout not found.");
      setIsLoading(false);
      return;
    }

    const { data: exerciseData, error: exerciseError } = await supabase
      .from("session_exercises")
      .select("id, session_id, position, name, sets, rest_seconds")
      .eq("session_id", sessionId)
      .order("position", { ascending: true });

    if (exerciseError || !exerciseData) {
      setErrorMessage(exerciseError?.message ?? "Could not load exercises.");
      setIsLoading(false);
      return;
    }

    const exerciseIds = exerciseData.map((exercise) => exercise.id);
    const { data: setData, error: setError } =
      exerciseIds.length > 0
        ? await supabase
            .from("session_sets")
            .select("id, session_exercise_id, set_number, weight, reps, completed_at")
            .in("session_exercise_id", exerciseIds)
        : { data: [], error: null };

    if (setError) {
      setErrorMessage(setError.message);
      setIsLoading(false);
      return;
    }

    const loadedSets = setData ?? [];
    const loadedLastSet = getLastCompletedSet(loadedSets);

    setSession(sessionData);
    setExercises(exerciseData);
    setSets(loadedSets);
    // Hydrates the logging inputs from whatever's actually saved, so a
    // refresh shows previously-saved values instead of blanking them.
    setWeightInput(loadedLastSet?.weight != null ? String(loadedLastSet.weight) : "");
    setRepsInput(loadedLastSet?.reps != null ? String(loadedLastSet.reps) : "");
    setIsLoading(false);
  }

  useEffect(() => {
    function runInitialLoad() {
      loadSession();
    }
    runInitialLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const progress = getSessionProgress(exercises, sets);
  const lastSet = getLastCompletedSet(sets);
  const lastSetExercise = lastSet
    ? exercises.find((exercise) => exercise.id === lastSet.session_exercise_id) ?? null
    : null;
  // No rest after the workout's true final set — nothing is left to rest
  // for, so completing it goes straight to logging + Finish Workout.
  const isResting =
    lastSet !== null &&
    lastSet.id !== dismissedSetId &&
    lastSetExercise !== null &&
    progress.status !== "complete";
  const nextProgress = progress.status === "in-progress" ? getNextProgress(exercises, sets, progress) : null;

  // Persists whatever is currently in the weight/reps inputs onto the given
  // set. Called on blur (the normal path) and always awaited before that
  // set's inputs could otherwise be reset for a newly-completed set, so a
  // still-focused, not-yet-blurred edit is never dropped.
  async function saveResult(setId: string) {
    const weight = weightInput.trim() === "" ? null : Number(weightInput);
    const reps = repsInput.trim() === "" ? null : Number(repsInput);

    const { error } = await supabase
      .from("session_sets")
      .update({ weight, reps })
      .eq("id", setId);

    if (error) {
      // The set itself is already saved — only the optional weight/reps
      // annotation failed. Surface it but don't block the workout on it.
      setErrorMessage(`Couldn't save set details: ${error.message}`);
      return;
    }

    setSets((current) =>
      current.map((set) => (set.id === setId ? { ...set, weight, reps } : set))
    );
  }

  // Completing a set is deliberately blind to weight/reps — it only records
  // that the set happened, right when it happened. The weight/reps inputs
  // stay bound to the *previous* lastSet right up until this call, so any
  // pending edit for it is flushed here (in parallel with the new insert)
  // before the inputs get reset for the set that was just completed.
  async function handleCompleteSet(exercise: SessionExercise, setNumber: number) {
    setIsLoggingSet(true);
    setErrorMessage(null);

    const previousLastSet = lastSet;

    const [insertResult] = await Promise.all([
      supabase
        .from("session_sets")
        .insert({
          session_exercise_id: exercise.id,
          set_number: setNumber,
          weight: null,
          reps: null,
        })
        .select("id, session_exercise_id, set_number, weight, reps, completed_at")
        .single(),
      previousLastSet ? saveResult(previousLastSet.id) : Promise.resolve(),
    ]);

    const { data, error } = insertResult;

    if (error) {
      // A unique-constraint hit means this exact set was already logged
      // (e.g. a double tap) — just resync from the database instead of
      // showing a scary error for something harmless.
      if (error.code === "23505") {
        await loadSession();
        setIsLoggingSet(false);
        return;
      }
      setErrorMessage(`Couldn't log set: ${error.message}`);
      setIsLoggingSet(false);
      return;
    }

    setSets((current) => [...current, data]);
    setWeightInput("");
    setRepsInput("");
    setIsLoggingSet(false);
  }

  async function handleFinishWorkout() {
    if (!session) {
      return;
    }
    setIsFinishing(true);
    setErrorMessage(null);

    if (lastSet) {
      await saveResult(lastSet.id);
    }

    const { error } = await supabase
      .from("workout_sessions")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", session.id);

    if (error) {
      setErrorMessage(`Couldn't finish workout: ${error.message}`);
      setIsFinishing(false);
      return;
    }

    router.push("/workouts");
  }

  function renderBody() {
    if (isLoading) {
      return <p className="p-1 text-sm text-muted-foreground">Loading workout...</p>;
    }

    if (!session) {
      return (
        <p className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
          {errorMessage ?? "Workout not found."}
        </p>
      );
    }

    if (session.completed_at) {
      return (
        <p className="px-1 py-6 text-center text-sm text-muted-foreground">
          This workout is already finished.
        </p>
      );
    }

    return (
      <div className="flex flex-col gap-4">
        {/* Primary content: whatever answers "what am I supposed to be doing
            right now" — resting, performing the upcoming set, or finishing. */}
        {isResting && lastSet && lastSetExercise ? (
          <RestTimer
            exerciseName={lastSetExercise.name}
            restEndAt={getRestEndAt(lastSet, lastSetExercise)}
            onAdvance={() => setDismissedSetId(lastSet.id)}
          />
        ) : progress.status === "in-progress" ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface p-5 text-center">
            <span className="text-xs font-semibold uppercase tracking-wide text-primary">
              Up Now
            </span>
            <p className="text-3xl font-bold uppercase leading-tight text-foreground">
              {progress.exercise.name}
            </p>
            <p className="text-base text-muted-foreground">
              Set {progress.setNumber} of {progress.exercise.sets}
            </p>
            <button
              type="button"
              onClick={() => handleCompleteSet(progress.exercise, progress.setNumber)}
              disabled={isLoggingSet}
              className="min-h-14 w-full max-w-xs rounded-xl bg-primary px-4 text-lg font-semibold text-primary-foreground transition hover:bg-primary/90 active:bg-primary/80 disabled:opacity-50"
            >
              {isLoggingSet ? "Logging..." : "Complete Set"}
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-surface p-5 py-8 text-center">
            <p className="text-lg font-semibold text-foreground">All sets complete.</p>
            <button
              type="button"
              onClick={handleFinishWorkout}
              disabled={isFinishing}
              className="min-h-11 w-full max-w-xs rounded-xl bg-primary px-4 text-base font-medium text-primary-foreground transition hover:bg-primary/90 active:bg-primary/80 disabled:opacity-50"
            >
              {isFinishing ? "Finishing..." : "Finish Workout"}
            </button>
          </div>
        )}

        {isResting && (
          <p className="text-center text-sm text-muted-foreground">
            Up next: <UpNextLabel progress={progress} />
          </p>
        )}
        {!isResting && progress.status === "in-progress" && nextProgress && (
          <p className="text-center text-sm text-muted-foreground">
            Up next: <UpNextLabel progress={nextProgress} />
          </p>
        )}

        {/* Demoted: logging for the set that was just completed. Available
            both while resting and once idle — never the primary focus. */}
        {lastSet && lastSetExercise && (
          <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-surface-muted/40 p-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Log Previous Set
              </span>
            </div>
            <p className="text-sm font-medium text-foreground">
              <span className="uppercase">{lastSetExercise.name}</span> &middot; Set{" "}
              {lastSet.set_number}
            </p>
            <div className="flex gap-3">
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Weight (optional)
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={weightInput}
                  onChange={(event) => setWeightInput(event.target.value)}
                  onBlur={() => saveResult(lastSet.id)}
                  placeholder="—"
                  aria-label="Weight for the set you just completed"
                  className="min-h-11 w-full min-w-0 rounded-xl border border-border bg-surface-muted px-3 text-center text-lg text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Reps (optional)</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={repsInput}
                  onChange={(event) => setRepsInput(event.target.value)}
                  onBlur={() => saveResult(lastSet.id)}
                  placeholder="—"
                  aria-label="Reps for the set you just completed"
                  className="min-h-11 w-full min-w-0 rounded-xl border border-border bg-surface-muted px-3 text-center text-lg text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
            </div>
          </div>
        )}
      </div>
    );
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
        {session && (
          <h1 className="text-xl font-bold uppercase tracking-tight text-primary">{session.name}</h1>
        )}
      </div>

      {errorMessage && session?.completed_at === null && (
        <p className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
          {errorMessage}
        </p>
      )}

      {renderBody()}
    </div>
  );
}

export type WorkoutTemplate = {
  id: string;
  name: string;
  created_at: string;
};

export type TemplateExercise = {
  id: string;
  template_id: string;
  position: number;
  name: string;
  sets: number;
  rest_seconds: number;
};

export type WorkoutSession = {
  id: string;
  template_id: string | null;
  name: string;
  started_at: string;
  completed_at: string | null;
};

export type SessionExercise = {
  id: string;
  session_id: string;
  position: number;
  name: string;
  sets: number;
  rest_seconds: number;
};

export type SessionSet = {
  id: string;
  session_exercise_id: string;
  set_number: number;
  weight: number | null;
  reps: number | null;
  completed_at: string;
};

export type SessionProgress =
  | {
      status: "in-progress";
      exercise: SessionExercise;
      exerciseIndex: number;
      setNumber: number;
    }
  | { status: "complete" };

// Progress (which exercise/set is next) is intentionally never stored — it's
// derived from how many session_sets exist per exercise, so a page refresh
// always reconstructs the right screen from what's actually been logged.
export function getSessionProgress(
  exercises: SessionExercise[],
  sets: SessionSet[]
): SessionProgress {
  const ordered = [...exercises].sort((a, b) => a.position - b.position);

  for (let index = 0; index < ordered.length; index++) {
    const exercise = ordered[index];
    const completedCount = sets.filter(
      (set) => set.session_exercise_id === exercise.id
    ).length;
    if (completedCount < exercise.sets) {
      return {
        status: "in-progress",
        exercise,
        exerciseIndex: index,
        setNumber: completedCount + 1,
      };
    }
  }

  return { status: "complete" };
}

// What comes after the given (not-yet-performed) set — same exercise's next
// set, the next exercise's first set, or "complete" if nothing remains.
// Reuses getSessionProgress against a hypothetical sets array rather than
// re-deriving the same walk a second time.
export function getNextProgress(
  exercises: SessionExercise[],
  sets: SessionSet[],
  current: { exercise: SessionExercise; setNumber: number }
): SessionProgress {
  const hypothetical: SessionSet = {
    id: "__preview__",
    session_exercise_id: current.exercise.id,
    set_number: current.setNumber,
    weight: null,
    reps: null,
    completed_at: new Date().toISOString(),
  };
  return getSessionProgress(exercises, [...sets, hypothetical]);
}

export function getLastCompletedSet(sets: SessionSet[]): SessionSet | null {
  if (sets.length === 0) {
    return null;
  }
  return sets.reduce((latest, set) =>
    new Date(set.completed_at) > new Date(latest.completed_at) ? set : latest
  );
}

// Rest end time is anchored to the completed set's server-recorded
// completed_at, not to whenever the client happens to render this — that's
// what keeps the countdown correct across backgrounding/refreshes.
export function getRestEndAt(
  lastSet: SessionSet,
  exercise: SessionExercise
): string {
  const endMs = new Date(lastSet.completed_at).getTime() + exercise.rest_seconds * 1000;
  return new Date(endMs).toISOString();
}

export function formatDuration(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// Accepts either plain seconds ("90") or m:ss ("1:30") and normalizes to an
// integer number of seconds for storage. Returns null for anything else so
// callers can show a validation error instead of saving garbage.
export function parseRestDuration(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") {
    return null;
  }

  const withColon = trimmed.match(/^(\d+):([0-5]?\d)$/);
  if (withColon) {
    return Number(withColon[1]) * 60 + Number(withColon[2]);
  }

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  return null;
}

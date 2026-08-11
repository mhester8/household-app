"use client";

import { useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/workouts";

// Shared across rest periods — RestTimer unmounts between them, and reusing
// one AudioContext instead of creating a fresh one each time avoids running
// into the browser's cap on how many can exist at once over a long workout.
let sharedAudioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    return null;
  }
  if (!sharedAudioContext) {
    sharedAudioContext = new Ctor();
  }
  return sharedAudioContext;
}

// A single short, quiet chime (a quick rising tone, ~300ms) synthesized with
// the Web Audio API — no audio file/dependency to ship. Never loops, so it
// can't turn into an alarm. Autoplay/permission restrictions are expected:
// if resume() or playback is blocked, this just no-ops rather than throwing,
// since the workout itself never depends on sound.
function playRestCompleteChime() {
  const ctx = getAudioContext();
  if (!ctx) {
    return;
  }

  Promise.resolve(ctx.state === "suspended" ? ctx.resume() : undefined)
    .then(() => {
      const now = ctx.currentTime;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(660, now);
      oscillator.frequency.exponentialRampToValueAtTime(880, now + 0.15);

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.15, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);

      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.3);
    })
    .catch(() => {
      // Blocked by autoplay/permission restrictions — skip silently.
    });
}

// Timestamp-based on purpose: remaining time is recomputed from the wall
// clock every tick rather than decremented, so backgrounding the tab,
// locking the phone, timer throttling, or refreshing the page never makes
// the countdown drift or go stale. onAdvance fires automatically the first
// time remaining time reaches zero (guarded so it only fires once per rest
// period, including the case where the page loads after time already
// elapsed) — it never marks or creates anything itself, it only tells the
// parent to move the UI on.
export function RestTimer({
  exerciseName,
  restEndAt,
  onAdvance,
}: {
  exerciseName: string;
  restEndAt: string;
  onAdvance: () => void;
}) {
  const targetMs = new Date(restEndAt).getTime();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const hasAutoAdvancedRef = useRef(false);

  useEffect(() => {
    if (Date.now() >= targetMs) {
      return;
    }
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [targetMs]);

  // Force an immediate recompute on return from background — the interval
  // above may have been throttled or paused while the tab was hidden.
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === "visible") {
        setNowMs(Date.now());
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // A rest period only ever starts right after a Complete Set tap, so this
  // mount is as close as this component ever gets to that user gesture —
  // resuming here (rather than waiting until the chime actually fires,
  // possibly minutes later) gives the browser its best chance to allow audio.
  useEffect(() => {
    getAudioContext()?.resume().catch(() => {});
  }, []);

  const remainingSeconds = (targetMs - nowMs) / 1000;
  const isDone = remainingSeconds <= 0;

  useEffect(() => {
    if (isDone && !hasAutoAdvancedRef.current) {
      hasAutoAdvancedRef.current = true;
      playRestCompleteChime();
      onAdvance();
    }
  }, [isDone, onAdvance]);

  return (
    <div className="flex flex-col items-center gap-5 rounded-2xl border border-border bg-surface px-4 py-10 text-center">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Resting &middot; {exerciseName}
      </p>
      <p className="text-6xl font-bold tabular-nums text-foreground">
        {formatDuration(remainingSeconds)}
      </p>
      {isDone && (
        <p className="text-sm text-muted-foreground">
          Rest complete &mdash; moving to the next set.
        </p>
      )}
      <button
        type="button"
        onClick={onAdvance}
        className="min-h-11 w-full max-w-xs rounded-xl bg-primary px-4 text-base font-medium text-primary-foreground transition hover:bg-primary/90 active:bg-primary/80"
      >
        {isDone ? "Start Next Set" : `Next Set Now · ${formatDuration(remainingSeconds)}`}
      </button>
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import type { RealtimeChannel, REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

// Minimum gap between recovery attempts for one subscription. Guards against
// a tight loop if the transport keeps failing immediately, and against two
// near-simultaneous triggers (e.g. a stale CHANNEL_ERROR landing right next
// to a proactive visibilitychange rebuild) both tearing the channel down.
const RECOVERY_COOLDOWN_MS = 3000;

// How long a channel has to stay unavailable, continuously, before the UI is
// told about it. A background/resume rebuild normally recovers within a
// second or two — showing nothing during that window is the point of this
// delay; only a genuinely sustained outage should surface a warning.
const WARNING_DELAY_MS = 5000;

// Copy shared by every caller that surfaces Realtime connection health, so
// each one clears (and only clears) its own banner — never an unrelated
// load/save error that happens to be occupying the same message slot.
export const REALTIME_UNAVAILABLE_MESSAGE =
  "Live updates are temporarily unavailable. Trying to reconnect…";

type RealtimeStatus = REALTIME_SUBSCRIBE_STATES;

/**
 * Owns one Realtime channel's create/subscribe/cleanup lifecycle, recovery
 * after a mobile background/resume cycle, and a debounced unavailable/
 * recovered signal for optional UI. Callers supply the channel's own
 * `.on("postgres_changes", ...)` bindings via `build` — this hook never
 * looks at event payloads, only subscription status.
 *
 * Recovery:
 * - `visibilitychange` to visible is treated as a genuine resume: the
 *   channel is torn down and recreated proactively, even if its last known
 *   status was still SUBSCRIBED — that can be stale from before the page
 *   was suspended, with the actual failure only reported some time later.
 *   The event only fires on a real hidden→visible transition, so this never
 *   runs on initial mount just because the page starts visible.
 * - `online` recovers only if the tracked status isn't already SUBSCRIBED.
 *   Unlike visibility, going offline is reliably reported, and `online`
 *   itself only fires after a genuine offline period, so this doesn't churn
 *   the channel for unrelated events.
 * - CHANNEL_ERROR/TIMED_OUT trigger recovery directly too, so a failure
 *   reported some time after either lifecycle event (or with no lifecycle
 *   event at all) still gets picked up.
 *
 * UI signal: `onUnavailable` fires only once the channel has been down
 * continuously for WARNING_DELAY_MS — a brief, successful recovery never
 * calls it. `onRecovered` fires on every SUBSCRIBED, clearing any pending
 * or already-shown warning.
 */
export function useRealtimeSubscription(options: {
  channelName: string;
  build: (channel: RealtimeChannel) => RealtimeChannel;
  deps: ReadonlyArray<unknown>;
  enabled?: boolean;
  onUnavailable?: () => void;
  onRecovered?: () => void;
}) {
  const { channelName, enabled = true } = options;

  // Kept in sync after every render (in an effect, not during render — a
  // direct write here trips the "no ref writes during render" rule) so a
  // recovery that happens long after the last render still uses the latest
  // closures (current filters, current setState callbacks) — without
  // forcing the subscription effect itself to re-run on every render.
  const buildRef = useRef(options.build);
  const onUnavailableRef = useRef(options.onUnavailable);
  const onRecoveredRef = useRef(options.onRecovered);
  useEffect(() => {
    buildRef.current = options.build;
    onUnavailableRef.current = options.onUnavailable;
    onRecoveredRef.current = options.onRecovered;
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let status: RealtimeStatus | "PENDING" = "PENDING";
    let isRecovering = false;
    let lastRecoveryAt = 0;
    let warningTimer: ReturnType<typeof setTimeout> | null = null;

    function clearWarningTimer() {
      if (warningTimer) {
        clearTimeout(warningTimer);
        warningTimer = null;
      }
    }

    function openChannel() {
      const next = supabase.channel(channelName);
      buildRef.current(next);
      channel = next;
      next.subscribe((nextStatus, err) => {
        // A callback from a channel instance that recovery has already
        // superseded — ignore it so it can't stomp the current status,
        // re-trigger recovery, or resurrect a warning for a channel nobody's
        // using any more.
        if (cancelled || channel !== next) {
          return;
        }
        status = nextStatus;

        if (nextStatus === "CHANNEL_ERROR" || nextStatus === "TIMED_OUT") {
          // Expected/recoverable — the hook is already retrying. Not
          // console.error: that trips Next's dev error overlay for a
          // transport drop that's normal after a mobile background/resume
          // and usually resolves on its own within a second or two.
          console.warn(`Realtime (${channelName}): ${nextStatus} — attempting recovery`, err ?? "");
          if (!warningTimer) {
            warningTimer = setTimeout(() => {
              warningTimer = null;
              onUnavailableRef.current?.();
            }, WARNING_DELAY_MS);
          }
          recover();
        } else if (nextStatus === "SUBSCRIBED") {
          clearWarningTimer();
          onRecoveredRef.current?.();
        }
      });
    }

    async function recover() {
      if (cancelled || isRecovering) {
        return;
      }
      const now = Date.now();
      if (now - lastRecoveryAt < RECOVERY_COOLDOWN_MS) {
        return;
      }
      isRecovering = true;
      lastRecoveryAt = now;
      try {
        if (channel) {
          await supabase.removeChannel(channel);
        }
        if (!cancelled) {
          openChannel();
        }
      } finally {
        isRecovering = false;
      }
    }

    function handleVisible() {
      if (document.visibilityState === "visible") {
        recover();
      }
    }

    function handleOnline() {
      if (status !== "SUBSCRIBED") {
        recover();
      }
    }

    openChannel();
    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("online", handleOnline);

    return () => {
      cancelled = true;
      clearWarningTimer();
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("online", handleOnline);
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
    // deps is caller-supplied and intentionally spread below; the hook's
    // contract is that `deps` lists everything that should tear down and
    // recreate the subscription, same as a normal effect dependency array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, enabled, ...options.deps]);
}

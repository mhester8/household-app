"use client";

import { useEffect, useRef, useState } from "react";
import { classifyPullDelta, type PullGestureState } from "./pullToRefreshGesture";

export type PullToRefreshStatus = PullGestureState | "refreshing";

// A drag starting inside one of these shouldn't be read as a pull — it's the
// user interacting with the control (placing a caret, opening a select),
// not pulling the page.
const INTERACTIVE_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/**
 * Dependency-free pull-to-refresh for a document-level scroller. Touch
 * listeners are all passive — this never calls preventDefault, so it never
 * fights normal scrolling or the browser's own overscroll/rubber-band; it
 * only watches touch deltas to drive a small status the caller can render,
 * and to invoke `onRefresh` once per completed pull past the threshold.
 * Gesture mechanics only — the caller owns what "refresh" actually does.
 */
export function usePullToRefresh(onRefresh: () => Promise<void>): PullToRefreshStatus {
  const [status, setStatus] = useState<PullToRefreshStatus>("idle");
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  });

  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let tracking = false;
    let armed = false;
    let refreshing = false;

    function atTop() {
      return (document.scrollingElement?.scrollTop ?? 0) <= 0;
    }

    function handleTouchStart(event: TouchEvent) {
      if (refreshing || event.touches.length !== 1) {
        tracking = false;
        return;
      }
      const target = event.target;
      if (target instanceof Element && target.closest(INTERACTIVE_SELECTOR)) {
        tracking = false;
        return;
      }
      if (!atTop()) {
        tracking = false;
        return;
      }
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      tracking = true;
      armed = false;
    }

    function handleTouchMove(event: TouchEvent) {
      if (!tracking || refreshing) {
        return;
      }
      // The page may have scrolled away from the top since touchstart (e.g.
      // native rubber-band settling, or content shifting) — a pull no longer
      // makes sense once that's happened.
      if (!atTop()) {
        tracking = false;
        setStatus("idle");
        return;
      }

      const touch = event.touches[0];
      const result = classifyPullDelta(touch.clientX - startX, touch.clientY - startY);

      if (result === "abandon") {
        tracking = false;
        setStatus("idle");
        return;
      }

      armed = result === "ready";
      setStatus(result);
    }

    function endGesture() {
      if (!tracking) {
        return;
      }
      tracking = false;

      if (!armed) {
        setStatus("idle");
        return;
      }

      armed = false;
      refreshing = true;
      setStatus("refreshing");
      onRefreshRef
        .current()
        .catch(() => {})
        .finally(() => {
          refreshing = false;
          setStatus("idle");
        });
    }

    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchmove", handleTouchMove, { passive: true });
    document.addEventListener("touchend", endGesture, { passive: true });
    document.addEventListener("touchcancel", endGesture, { passive: true });

    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", endGesture);
      document.removeEventListener("touchcancel", endGesture);
    };
  }, []);

  return status;
}

"use client";

import { useEffect, useState, type RefObject } from "react";
import { classifyPullDelta, type PullGestureState } from "./pullToRefreshGesture";

export type PullToRefreshStatus = PullGestureState | "refreshing";
export type PullToRefreshHandler = () => Promise<void>;

// A drag starting inside one of these shouldn't be read as a pull — it's the
// user interacting with the control (placing a caret, opening a select),
// not pulling the page.
const INTERACTIVE_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/**
 * Dependency-free pull-to-refresh gesture for a document-level scroller.
 * Meant to be mounted exactly once, by PullToRefreshProvider (see
 * lib/PullToRefreshContext.tsx) — `handlerRef` is read at the moment a pull
 * completes, so whichever page most recently registered via
 * usePullToRefreshHandler is the one that runs; a page that never registers
 * one (`handlerRef.current` stays null) simply never activates the gesture.
 * Touch listeners are all passive — this never calls preventDefault, so it
 * never fights normal scrolling or the browser's own overscroll/rubber-band.
 */
export function usePullToRefresh(handlerRef: RefObject<PullToRefreshHandler | null>): PullToRefreshStatus {
  const [status, setStatus] = useState<PullToRefreshStatus>("idle");

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
      if (refreshing || event.touches.length !== 1 || !handlerRef.current) {
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

      const handler = armed ? handlerRef.current : null;
      armed = false;

      if (!handler) {
        setStatus("idle");
        return;
      }

      refreshing = true;
      setStatus("refreshing");
      handler()
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
    // handlerRef is a stable ref object for the provider's lifetime — this
    // effect is meant to run once per app-session mount, not per registration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return status;
}

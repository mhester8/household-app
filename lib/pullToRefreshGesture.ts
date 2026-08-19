// Pure decision logic for one in-progress pull-to-refresh touch gesture,
// factored out of lib/usePullToRefresh.ts so it's unit-testable without a
// DOM (same rationale as lib/groceryReconciliation.ts). Given how far a
// touch has moved from its start point, decides whether that still reads as
// a downward pull, and if so how far along it is.

// 64px release threshold — in the 60-80px range identified during the
// pull-to-refresh inspection, comfortably past normal scroll jitter but
// still a short, low-effort pull on a phone.
export const PULL_THRESHOLD_PX = 64;

// Below this on both axes, a touch's direction is just noise (finger
// settling after touchdown) — stay idle rather than committing to a
// direction from a couple of pixels of movement.
const MIN_MOVEMENT_PX = 4;

export type PullGestureState = "idle" | "pulling" | "ready";

// "abandon" means this touch sequence has revealed itself to be something
// other than a pull (a horizontal/diagonal swipe) and the caller should stop
// tracking it as a pull-refresh candidate for the rest of the gesture.
export type PullClassification = PullGestureState | "abandon";

export function classifyPullDelta(deltaX: number, deltaY: number): PullClassification {
  if (deltaY <= 0) {
    // Back at (or above) the start point — not currently pulling, but still
    // a valid pull candidate if the finger moves down again.
    return "idle";
  }

  if (deltaY < MIN_MOVEMENT_PX && Math.abs(deltaX) < MIN_MOVEMENT_PX) {
    return "idle";
  }

  if (Math.abs(deltaX) > deltaY) {
    return "abandon";
  }

  return deltaY >= PULL_THRESHOLD_PX ? "ready" : "pulling";
}

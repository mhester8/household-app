"use client";

import { createContext, useContext, useEffect, useRef, type ReactNode, type RefObject } from "react";
import { usePullToRefresh, type PullToRefreshHandler } from "./usePullToRefresh";
import { PullToRefreshIndicator } from "@/components/PullToRefreshIndicator";

const PullToRefreshHandlerContext = createContext<RefObject<PullToRefreshHandler | null> | null>(null);

// Owns the single global pull gesture and its indicator for every
// authenticated route. handlerRef is the one slot descendant pages write
// into via usePullToRefreshHandler below — there's only ever one page
// mounted under this provider at a time, so there's no contention over who
// "owns" the slot, just whoever currently holds it.
export function PullToRefreshProvider({ children }: { children: ReactNode }) {
  const handlerRef = useRef<PullToRefreshHandler | null>(null);
  const status = usePullToRefresh(handlerRef);

  return (
    <PullToRefreshHandlerContext.Provider value={handlerRef}>
      <PullToRefreshIndicator status={status} />
      {children}
    </PullToRefreshHandlerContext.Provider>
  );
}

// Registers `refreshFn` as the current page's pull-to-refresh action while
// mounted, and clears it on unmount. The registration effect itself only
// runs once per mount/unmount (empty deps) — refreshFn's latest closure is
// kept fresh separately via latestFnRef, so callers never need to memoize
// what they pass in. Same "ref holds the latest closure" shape
// lib/useRealtimeSubscription.ts already uses for its callbacks.
export function usePullToRefreshHandler(refreshFn: PullToRefreshHandler) {
  const handlerRef = useContext(PullToRefreshHandlerContext);
  const latestFnRef = useRef(refreshFn);

  useEffect(() => {
    latestFnRef.current = refreshFn;
  });

  useEffect(() => {
    if (!handlerRef) {
      return;
    }
    const wrapper: PullToRefreshHandler = () => latestFnRef.current();
    handlerRef.current = wrapper;
    return () => {
      // Only clear the slot if it's still this registration's own wrapper —
      // guards against clobbering a newer page's handler if effect ordering
      // ever surprises us during a route transition.
      if (handlerRef.current === wrapper) {
        handlerRef.current = null;
      }
    };
  }, [handlerRef]);
}

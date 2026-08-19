import type { PullToRefreshStatus } from "@/lib/usePullToRefresh";

// Fixed banner above all app content — pull-to-refresh's only UI, shared by
// every participating page. Hidden (translated above the viewport) at rest
// so it never consumes layout space; a plain CSS transition reveals it, no
// animation library.
export function PullToRefreshIndicator({ status }: { status: PullToRefreshStatus }) {
  const isVisible = status !== "idle";
  const label =
    status === "ready" ? "Release to refresh" : status === "refreshing" ? "Refreshing…" : "Pull to refresh";

  return (
    <div
      aria-live="polite"
      className={`pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-2 transition-transform duration-200 ${
        isVisible ? "translate-y-0" : "-translate-y-full"
      }`}
    >
      <div className="rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-medium text-muted-foreground shadow-sm">
        {isVisible ? label : ""}
      </div>
    </div>
  );
}

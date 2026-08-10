export type ToastState = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: "default" | "danger";
};

// Single-slot snackbar anchored above the thumb zone on mobile. Callers own
// the auto-dismiss timer (see useToast in the groceries page) — this
// component just renders whatever state it's given.
export function Toast({
  toast,
  onDismiss,
}: {
  toast: ToastState;
  onDismiss: () => void;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-3">
      <div
        role="status"
        className={`pointer-events-auto flex max-w-md flex-1 items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm shadow-lg sm:flex-none ${
          toast.tone === "danger"
            ? "border-danger/30 bg-danger text-primary-foreground"
            : "border-border bg-foreground text-page"
        }`}
      >
        <span className="min-w-0 flex-1 break-words">{toast.message}</span>
        {toast.actionLabel && toast.onAction && (
          <button
            type="button"
            onClick={() => {
              toast.onAction?.();
              onDismiss();
            }}
            className="shrink-0 rounded-md px-2 py-1 text-sm font-semibold underline underline-offset-2 hover:no-underline"
          >
            {toast.actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

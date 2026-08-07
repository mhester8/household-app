export function LeafIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M4 15c0-6 4.5-11 15-11 0 10.5-5 15-11 15-2.5 0-4-1-4-4Z" />
      <path d="M5 19c3-3 6-6 12-11" />
    </svg>
  );
}

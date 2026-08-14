import Link from "next/link";

function FeatureCard({
  href,
  title,
  description,
}: {
  href?: string;
  title: string;
  description: string;
}) {
  const content = (
    <>
      <div className="flex flex-col gap-0.5">
        <span className="text-base font-semibold text-foreground">{title}</span>
        <span className="text-sm text-muted-foreground">{description}</span>
      </div>
      {href ? (
        <span aria-hidden="true" className="text-xl text-primary">
          &rsaquo;
        </span>
      ) : (
        <span className="shrink-0 rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
          Coming soon
        </span>
      )}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-4 transition hover:border-primary/40 active:bg-surface-muted"
      >
        {content}
      </Link>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-4 opacity-70">
      {content}
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="flex flex-col gap-2">
      <FeatureCard
        href="/groceries"
        title="Groceries"
        description="Shared shopping list"
      />
      <FeatureCard title="Notes & To-Dos" description="Coming soon" />
      <FeatureCard href="/workouts" title="Workouts" description="Templates & sessions" />
      <FeatureCard href="/recipes" title="Recipes" description="Saved recipe library" />
      <FeatureCard href="/pinterest" title="Pinterest" description="Connect your account" />
    </div>
  );
}

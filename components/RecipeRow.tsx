"use client";

import { useState } from "react";
import Link from "next/link";
import { LeafIcon } from "@/components/LeafIcon";

// One compact, mobile-first row for the Recipe Library list: fixed-size
// thumbnail, title, an optional metadata line, and the chevron open
// affordance. A plain <img> is used deliberately instead of next/image —
// recipe images come from arbitrary third-party sites, and next/image
// requires each remote host to be allowlisted in next.config.ts, which
// isn't practical for sources not known ahead of time.
export function RecipeRow({
  href,
  title,
  imageUrl,
  metadata,
}: {
  href: string;
  title: string;
  imageUrl: string | null;
  metadata: string | null;
}) {
  // Tracks a failed image load (dead link, blocked hotlink, etc.) so the
  // row falls back to the placeholder instead of showing a broken-image
  // icon. Reset is unnecessary here — imageUrl changing at all remounts
  // this component under a fresh `key` from the recipe's id in the list.
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = imageUrl !== null && !imageFailed;

  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-2.5 py-2 transition hover:bg-surface-muted"
    >
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-muted">
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary third-party recipe-site domains, see module comment
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            onError={() => setImageFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <LeafIcon className="h-6 w-6 text-muted-foreground/50" />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[15px] font-medium text-foreground">{title}</span>
        {metadata && <span className="truncate text-sm text-muted-foreground">{metadata}</span>}
      </div>

      <span aria-hidden="true" className="shrink-0 text-xl text-primary">
        &rsaquo;
      </span>
    </Link>
  );
}

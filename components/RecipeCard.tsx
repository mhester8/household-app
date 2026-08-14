"use client";

import { useState } from "react";
import Link from "next/link";
import { LeafIcon } from "@/components/LeafIcon";

// One card in the Recipe Library's 2-column grid: a large square image (or
// leaf placeholder) on top, title and compact metadata below, the whole
// card as a single link — no chevron, since a card's own tap surface is the
// affordance here rather than a trailing glyph. A plain <img> is used
// deliberately instead of next/image, same reasoning as RecipeRow: recipe
// images come from arbitrary third-party sites, and next/image requires
// each remote host to be allowlisted in next.config.ts, which isn't
// practical for sources not known ahead of time.
export function RecipeCard({
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
  // card falls back to the placeholder instead of showing a broken-image
  // icon. Reset is unnecessary here — imageUrl changing at all remounts
  // this component under a fresh `key` from the recipe's id in the grid.
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = imageUrl !== null && !imageFailed;

  return (
    <Link
      href={href}
      className="flex flex-col overflow-hidden rounded-xl bg-surface-muted transition active:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex aspect-square w-full items-center justify-center overflow-hidden bg-surface-muted">
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
          <LeafIcon className="h-10 w-10 text-muted-foreground/60" />
        )}
      </div>

      {/* min-h reserves space for a 2-line title + one metadata line so
          neighboring cards in the same grid row stay the same height even
          when one recipe's title is short or its metadata is absent. */}
      <div className="flex min-h-[4.5rem] flex-col gap-1 px-2.5 py-2">
        <span className="line-clamp-2 text-[13px] font-medium leading-snug text-foreground">
          {title}
        </span>
        {metadata && <span className="truncate text-[11px] text-muted-foreground">{metadata}</span>}
      </div>
    </Link>
  );
}

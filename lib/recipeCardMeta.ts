// Small shared formatter for the Recipe Library card's compact metadata
// line (time + servings). Kept separate from recipeTime.ts because it
// combines two independent domains — duration formatting and free-text
// servings — into one presentation-only string for a single call site (the
// library list row), rather than being general duration logic itself. No
// Supabase/Next.js imports, so this stays testable with plain Node, same
// as recipeTime.ts.

import { formatDuration, type RecipeTimes } from "./recipeTime.ts";

// Only a bare integer count ("6") gets the "Serves " label added. Anything
// that already reads as a complete phrase on its own — "Serves 6", "6
// servings", "Makes 12 muffins" — is shown verbatim: labeling it again
// would either duplicate the word "Serves" or read awkwardly ("Serves 6
// servings"). Deliberately conservative, same spirit as recipeServings.ts's
// narrow YIELD_PATTERNS: when in doubt, pass the source text through
// unchanged rather than guessing at a rewrite.
export function formatServingsLabel(servings: string | null): string | null {
  if (servings === null) {
    return null;
  }
  const trimmed = servings.trim();
  if (trimmed === "") {
    return null;
  }
  return /^\d+$/.test(trimmed) ? `Serves ${trimmed}` : trimmed;
}

// Recipe Library card: a single compact "<time> · <servings>" line, with
// whichever side is unknown simply omitted (never a stray "·" or blank
// segment). Prefers total time, shown bare ("45 min", not "Total 45 min") —
// this is a single-line list row, not the detail page's labeled breakdown.
// When total is unknown, falls back to prep and/or cook — but unlike total,
// a bare prep or cook duration is ambiguous on its own ("20 min" doesn't
// say whether that's prep or cook), so those two stay labeled ("Prep 20
// min", "Cook 30 min") even in this compact line.
export function cardMetadataLine(times: RecipeTimes, servings: string | null): string | null {
  const total = formatDuration(times.totalTimeMinutes);
  const prep = formatDuration(times.prepTimeMinutes);
  const cook = formatDuration(times.cookTimeMinutes);

  let timeText: string | null;
  if (total) {
    timeText = total;
  } else {
    const labeled = [prep && `Prep ${prep}`, cook && `Cook ${cook}`].filter(
      (part): part is string => Boolean(part)
    );
    timeText = labeled.length > 0 ? labeled.join(" · ") : null;
  }

  const servingsText = formatServingsLabel(servings);

  return (
    [timeText, servingsText].filter((part): part is string => Boolean(part)).join(" · ") || null
  );
}

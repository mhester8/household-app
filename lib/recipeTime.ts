// Pure helpers for recipe prep/cook/total time: display formatting and the
// hours+minutes <-> total-minutes conversion used by the manual entry form.
// No Supabase/Next.js imports, so this stays testable with plain Node, same
// as recipeJsonLd.ts.

export type RecipeTimes = {
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  totalTimeMinutes: number | null;
};

// 15 -> "15 min", 60 -> "1 hr", 75 -> "1 hr 15 min". Null/zero/negative all
// mean "unknown" here, never "0 min" — callers must skip rendering when this
// returns null rather than showing a blank or zero label.
export function formatDuration(minutes: number | null): string | null {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) {
    return null;
  }
  const wholeMinutes = Math.round(minutes);
  const hours = Math.floor(wholeMinutes / 60);
  const remainder = wholeMinutes % 60;

  if (hours === 0) {
    return `${remainder} min`;
  }
  if (remainder === 0) {
    return `${hours} hr`;
  }
  return `${hours} hr ${remainder} min`;
}

// Recipe detail page: one labeled segment per value that's actually known,
// in Prep/Cook/Total order, omitting anything null so a partially-known
// recipe never shows "Prep: N/A" style placeholders.
export function detailTimeSegments(times: RecipeTimes): { label: string; text: string }[] {
  const segments: { label: string; text: string }[] = [];

  const prep = formatDuration(times.prepTimeMinutes);
  if (prep) {
    segments.push({ label: "Prep", text: prep });
  }
  const cook = formatDuration(times.cookTimeMinutes);
  if (cook) {
    segments.push({ label: "Cook", text: cook });
  }
  const total = formatDuration(times.totalTimeMinutes);
  if (total) {
    segments.push({ label: "Total", text: total });
  }

  return segments;
}

// Recipe Library card/list: compact, single string or null. Prefers Total
// alone when known; otherwise falls back to whichever of Prep/Cook are
// known. Never calculates a missing Total from Prep/Cook.
export function cardTimeSummary(times: RecipeTimes): string | null {
  const total = formatDuration(times.totalTimeMinutes);
  if (total) {
    return `Total ${total}`;
  }

  const parts: string[] = [];
  const prep = formatDuration(times.prepTimeMinutes);
  if (prep) {
    parts.push(`Prep ${prep}`);
  }
  const cook = formatDuration(times.cookTimeMinutes);
  if (cook) {
    parts.push(`Cook ${cook}`);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

// Splits stored total minutes into the two form fields' initial string
// values. A zero component is left blank rather than "0" so the inputs
// start clean (e.g. exactly 60 minutes prefills hours="1", minutes="").
export function totalMinutesToHoursMinutesStrings(totalMinutes: number | null): {
  hours: string;
  minutes: string;
} {
  if (totalMinutes === null || !Number.isFinite(totalMinutes) || totalMinutes <= 0) {
    return { hours: "", minutes: "" };
  }
  const wholeMinutes = Math.round(totalMinutes);
  const hours = Math.floor(wholeMinutes / 60);
  const minutes = wholeMinutes % 60;
  return {
    hours: hours > 0 ? String(hours) : "",
    minutes: minutes > 0 ? String(minutes) : "",
  };
}

// Combines the two form fields back into integer minutes for persistence.
// Both blank -> null (unknown), not zero. Negative or non-numeric input is
// reported as an error instead of being silently coerced.
export function hoursMinutesToTotalMinutes(
  hoursText: string,
  minutesText: string
): { minutes: number | null; error: string | null } {
  const trimmedHours = hoursText.trim();
  const trimmedMinutes = minutesText.trim();

  if (trimmedHours === "" && trimmedMinutes === "") {
    return { minutes: null, error: null };
  }

  const hours = trimmedHours === "" ? 0 : Number(trimmedHours);
  const minutes = trimmedMinutes === "" ? 0 : Number(trimmedMinutes);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || minutes < 0) {
    return { minutes: null, error: "Enter a valid time (0 or greater)." };
  }

  return { minutes: Math.round(hours * 60 + minutes), error: null };
}

// Cheap safeguard for multi-image recipe imports: overlapping screenshots
// occasionally lead the model to repeat one line verbatim right after
// itself at the seam between two images. This only collapses a line that
// is an exact match (after trim + whitespace/case normalization) of the
// line immediately before it, so legitimate repeats elsewhere in the list
// (e.g. "1 tsp salt" used in two unrelated sub-recipes) are left alone.
function normalizeForComparison(line: string): string {
  return line.trim().toLowerCase().replace(/\s+/g, " ");
}

export function dedupeAdjacentLines(lines: string[]): string[] {
  const result: string[] = [];
  let previousNormalized: string | null = null;

  for (const line of lines) {
    const normalized = normalizeForComparison(line);
    if (normalized !== "" && normalized === previousNormalized) {
      continue;
    }
    result.push(line);
    previousNormalized = normalized;
  }

  return result;
}

// Minimal Schema.org Recipe JSON-LD extractor/normalizer for the URL
// importer. Deliberately narrow: it only pulls text out of
// `<script type="application/ld+json">` tags with a regex rather than
// parsing the page as HTML/DOM. That's a reasonable v1 approach for this
// one job (grabbing verbatim script contents, not understanding page
// structure), but it isn't meant to be a long-term architectural choice —
// if real-world testing shows pages the regex can't handle, swap
// `extractJsonLdBlocks` for a real HTML/DOM parser without touching the
// normalization functions below it, which operate on already-parsed JSON.
//
// No fetch/Supabase/Next.js imports here on purpose, so this stays testable
// with plain Node.

export type NormalizedRecipeDraft = {
  title: string | null;
  ingredients: string[];
  steps: string[];
  servings: string | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  totalTimeMinutes: number | null;
};

const JSON_LD_SCRIPT_RE =
  /<script\b[^>]*type\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json')[^>]*>([\s\S]*?)<\/script\s*>/gi;

// Finds every JSON-LD <script> block on the page and parses each
// independently. A malformed block is skipped rather than aborting
// extraction — real pages often carry several JSON-LD blocks (Organization,
// WebSite, BreadcrumbList, ...) and one broken block shouldn't hide a valid
// Recipe block elsewhere on the same page.
export function extractJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];

  for (const match of html.matchAll(JSON_LD_SCRIPT_RE)) {
    const raw = match[1].trim();
    if (raw === "") {
      continue;
    }
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      continue;
    }
  }

  return blocks;
}

// A parsed JSON-LD block can itself be a single object, an array of
// objects, or an object with an `@graph` array bundling several nodes
// together (the common WordPress/Yoast SEO shape). This walks all three
// shapes down to a flat list of candidate nodes to type-check.
function collectCandidateNodes(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectCandidateNodes);
  }
  if (value && typeof value === "object") {
    const graph = (value as Record<string, unknown>)["@graph"];
    if (Array.isArray(graph)) {
      return graph.flatMap(collectCandidateNodes);
    }
    return [value];
  }
  return [];
}

function isRecipeNode(node: unknown): node is Record<string, unknown> {
  if (!node || typeof node !== "object") {
    return false;
  }
  const type = (node as Record<string, unknown>)["@type"];
  if (typeof type === "string") {
    return type === "Recipe";
  }
  if (Array.isArray(type)) {
    return type.includes("Recipe");
  }
  return false;
}

// Returns the first node across all blocks whose `@type` is (or includes)
// "Recipe", or null if none of the page's JSON-LD is a Recipe. Real pages
// rarely carry more than one Recipe node, so first-match is enough for v1.
export function findRecipeNode(blocks: unknown[]): Record<string, unknown> | null {
  for (const block of blocks) {
    for (const candidate of collectCandidateNodes(block)) {
      if (isRecipeNode(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function normalizeTitle(node: Record<string, unknown>): string | null {
  const name = node.name;
  if (typeof name !== "string") {
    return null;
  }
  const trimmed = name.trim();
  return trimmed === "" ? null : trimmed;
}

function normalizeYieldValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  return null;
}

// `recipeYield` is Schema.org's servings/yield field. Real pages give a
// single string ("4 servings"), a bare number (4), or — less commonly — an
// array of string/number values (e.g. some sites repeat the same value
// twice, or give ["6", "6 servings"]). For an array, the first usable value
// is used: sites that provide more than one generally lead with the
// primary one, and concatenating them would just look wrong in the review
// form — this stays a single free-text value, no scaling/math involved.
function normalizeServings(node: Record<string, unknown>): string | null {
  const raw = node.recipeYield;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const value = normalizeYieldValue(item);
      if (value) {
        return value;
      }
    }
    return null;
  }
  return normalizeYieldValue(raw);
}

// Schema.org's prepTime/cookTime/totalTime are ISO-8601 durations. Real
// recipe pages only ever need the hours-and-minutes subset of that format
// (PT20M, PT1H, PT1H30M) — this deliberately doesn't attempt days, weeks, or
// seconds, and returns null for anything outside that subset rather than
// guessing at a value.
const ISO_DURATION_RE = /^PT(?:(\d+)H)?(?:(\d+)M)?$/;

export function parseIsoDurationToMinutes(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = ISO_DURATION_RE.exec(value.trim());
  if (!match) {
    return null;
  }
  const [, hoursPart, minutesPart] = match;
  if (hoursPart === undefined && minutesPart === undefined) {
    return null;
  }
  const hours = hoursPart === undefined ? 0 : Number(hoursPart);
  const minutes = minutesPart === undefined ? 0 : Number(minutesPart);
  return hours * 60 + minutes;
}

// Some sites give an array of duration values for the same field. As with
// recipeYield, the first value that actually parses is used.
function normalizeDurationValue(value: unknown): number | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const minutes = parseIsoDurationToMinutes(item);
      if (minutes !== null) {
        return minutes;
      }
    }
    return null;
  }
  return parseIsoDurationToMinutes(value);
}

// `recipeIngredient` is the correct Schema.org property; `ingredients` is
// accepted too since it shows up on some real sites' (incorrect) markup and
// costs nothing extra to check.
function normalizeIngredients(node: Record<string, unknown>): string[] {
  const raw = node.recipeIngredient ?? node.ingredients;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

// A single HowToStep/plain string entry -> its text, or null if it has none.
function stepText(item: unknown): string | null {
  if (typeof item === "string") {
    const trimmed = item.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (item && typeof item === "object") {
    const record = item as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text : record.name;
    if (typeof text === "string") {
      const trimmed = text.trim();
      return trimmed === "" ? null : trimmed;
    }
  }
  return null;
}

function isHowToSection(item: unknown): item is Record<string, unknown> {
  if (!item || typeof item !== "object") {
    return false;
  }
  const type = (item as Record<string, unknown>)["@type"];
  return type === "HowToSection" || (Array.isArray(type) && type.includes("HowToSection"));
}

// `recipeInstructions` shows up as: a single string (occasionally
// newline-separated), an array of plain strings, an array of HowToStep
// objects, or an array of HowToSection objects (each holding its own
// itemListElement of HowToSteps). Sections are flattened into the same flat
// step list our schema already has room for, with the section's name kept
// as its own plain-text line right before its steps (per product decision:
// preserve the grouping information without adding a schema column).
export function flattenInstructions(raw: unknown): string[] {
  if (typeof raw === "string") {
    return raw
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter((line) => line !== "");
  }

  if (!Array.isArray(raw)) {
    return [];
  }

  const steps: string[] = [];

  for (const item of raw) {
    if (isHowToSection(item)) {
      const sectionName = typeof item.name === "string" ? item.name.trim() : "";
      if (sectionName !== "") {
        steps.push(sectionName);
      }
      const subItems = Array.isArray(item.itemListElement) ? item.itemListElement : [];
      for (const subItem of subItems) {
        const text = stepText(subItem);
        if (text) {
          steps.push(text);
        }
      }
      continue;
    }

    const text = stepText(item);
    if (text) {
      steps.push(text);
    }
  }

  return steps;
}

export function normalizeRecipeNode(node: Record<string, unknown>): NormalizedRecipeDraft {
  return {
    title: normalizeTitle(node),
    ingredients: normalizeIngredients(node),
    steps: flattenInstructions(node.recipeInstructions),
    servings: normalizeServings(node),
    prepTimeMinutes: normalizeDurationValue(node.prepTime),
    cookTimeMinutes: normalizeDurationValue(node.cookTime),
    totalTimeMinutes: normalizeDurationValue(node.totalTime),
  };
}

// Minimum bar for a draft to be worth showing the human review screen:
// matches the photo importer's existing "hasContent" rule exactly (title
// present OR at least one ingredient OR at least one step) rather than
// inventing a stricter one, so an imperfect-but-useful extraction still
// reaches the review form instead of being rejected outright.
export function hasUsableContent(draft: NormalizedRecipeDraft): boolean {
  return draft.title !== null || draft.ingredients.length > 0 || draft.steps.length > 0;
}

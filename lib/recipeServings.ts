// Pure helpers for desired-servings scaling: deriving a numeric yield from a
// recipe's free-text `servings`, computing a scale factor against a This
// Week entry's desired servings, and scaling the leading quantity of a
// single ingredient line. No Supabase/Next.js imports, so this stays
// testable with plain Node, same as recipeTime.ts and recipeJsonLd.ts.
//
// Deliberately narrow throughout: this is not a general yield/quantity
// parser. Anything that isn't clearly one of the recognized shapes is left
// alone (null / unscaled) rather than guessed.

// Only these exact shapes are treated as an unambiguous serving count.
// Notably excluded: unit words other than "servings"/"serving" (e.g. "8
// bowls"), non-numeric multipliers ("1 dozen"), and ranges ("4-6
// servings") — all intentionally fall through to null.
const YIELD_PATTERNS: RegExp[] = [
  /^(\d+)$/, // "6"
  /^(\d+)\s*servings?$/i, // "6 servings" / "6 serving"
  /^serves\s+(\d+)$/i, // "Serves 6"
  /^makes\s+(\d+)\s*servings?$/i, // "Makes 6 servings"
];

export function parseNumericServings(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  for (const pattern of YIELD_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (match) {
      return Number(match[1]);
    }
  }
  return null;
}

// Null whenever scaling isn't meaningful: an unparseable original yield, an
// unset/invalid desired count, or a desired count equal to the original
// (nothing to change — callers should treat null as "use the original text
// unchanged," which also avoids reformatting a quantity that doesn't
// actually need to change, e.g. turning "½" into "0.5" for no reason).
export function computeScaleFactor(
  originalServings: number | null,
  desiredServings: number | null
): number | null {
  if (originalServings === null || !Number.isFinite(originalServings) || originalServings <= 0) {
    return null;
  }
  if (desiredServings === null || !Number.isFinite(desiredServings) || desiredServings <= 0) {
    return null;
  }
  if (desiredServings === originalServings) {
    return null;
  }
  return desiredServings / originalServings;
}

const UNICODE_FRACTIONS: Record<string, number> = {
  "¼": 1 / 4,
  "½": 1 / 2,
  "¾": 3 / 4,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 1 / 8,
  "⅜": 3 / 8,
  "⅝": 5 / 8,
  "⅞": 7 / 8,
};
const UNICODE_FRACTION_CHARS = Object.keys(UNICODE_FRACTIONS).join("");

type LeadingQuantity = { value: number; matchedText: string };

// Tries each supported leading-quantity shape in order, most-specific
// first (a mixed number must be checked before a bare fraction, a decimal
// before a bare integer) so e.g. "1.5" isn't matched as the integer "1".
function matchLeadingQuantity(text: string): LeadingQuantity | null {
  const mixedUnicode = new RegExp(`^(\\d+)\\s?([${UNICODE_FRACTION_CHARS}])`).exec(text);
  if (mixedUnicode) {
    return { value: Number(mixedUnicode[1]) + UNICODE_FRACTIONS[mixedUnicode[2]], matchedText: mixedUnicode[0] };
  }

  const bareUnicode = new RegExp(`^([${UNICODE_FRACTION_CHARS}])`).exec(text);
  if (bareUnicode) {
    return { value: UNICODE_FRACTIONS[bareUnicode[1]], matchedText: bareUnicode[0] };
  }

  const mixedAscii = /^(\d+)\s+(\d+)\/(\d+)/.exec(text);
  if (mixedAscii) {
    const denominator = Number(mixedAscii[3]);
    if (denominator === 0) {
      return null;
    }
    return {
      value: Number(mixedAscii[1]) + Number(mixedAscii[2]) / denominator,
      matchedText: mixedAscii[0],
    };
  }

  const asciiFraction = /^(\d+)\/(\d+)/.exec(text);
  if (asciiFraction) {
    const denominator = Number(asciiFraction[2]);
    if (denominator === 0) {
      return null;
    }
    return { value: Number(asciiFraction[1]) / denominator, matchedText: asciiFraction[0] };
  }

  const decimal = /^(\d+\.\d+)/.exec(text);
  if (decimal) {
    return { value: Number(decimal[1]), matchedText: decimal[0] };
  }

  const integer = /^(\d+)/.exec(text);
  if (integer) {
    return { value: Number(integer[1]), matchedText: integer[0] };
  }

  return null;
}

// A small, fixed list of container/package words — not a general unit
// system. Scaling a count of these (e.g. "1 can black beans") would need
// purchasing logic ("buy 1 can, not 0.67 can") this module intentionally
// doesn't attempt, so lines like this are left unscaled instead.
const PACKAGE_UNIT_WORDS = new Set([
  "can",
  "cans",
  "box",
  "boxes",
  "package",
  "packages",
  "pkg",
  "jar",
  "jars",
  "bag",
  "bags",
  "bottle",
  "bottles",
  "container",
  "containers",
  "block",
  "blocks",
]);

// Whatever follows the matched leading quantity is checked for signals that
// it isn't a plain standalone amount: a range ("2-3 cloves", "4 to 6 oz"),
// a compound descriptor sharing the number ("1-inch piece ginger"), a
// parenthetical qualifying a different number ("1 (15 oz) can beans"), or a
// package/container word. Any of these means "don't guess" — leave the
// whole line untouched.
function isUnscalableContext(rest: string): boolean {
  if (/^\s*[-–—]/.test(rest)) {
    return true;
  }
  if (/^\s+to\s+\d/i.test(rest)) {
    return true;
  }
  if (/^\s*\(/.test(rest)) {
    return true;
  }
  const wordMatch = /^\s+([a-zA-Z]+)/.exec(rest);
  if (wordMatch && PACKAGE_UNIT_WORDS.has(wordMatch[1].toLowerCase())) {
    return true;
  }
  // "1 15-ounce can pumpkin puree" — a hyphenated size descriptor (itself a
  // number + unit) sitting between the leading count and a package word,
  // rather than the package word directly. Same fixed denylist as above,
  // just checked one word further out.
  const descriptorMatch = /^\s+\d+(?:\.\d+)?-[a-zA-Z]+\s+([a-zA-Z]+)/.exec(rest);
  if (descriptorMatch && PACKAGE_UNIT_WORDS.has(descriptorMatch[1].toLowerCase())) {
    return true;
  }
  return false;
}

const NICE_FRACTIONS: { value: number; display: string }[] = [
  { value: 1 / 8, display: "⅛" },
  { value: 1 / 4, display: "¼" },
  { value: 1 / 3, display: "⅓" },
  { value: 3 / 8, display: "⅜" },
  { value: 1 / 2, display: "½" },
  { value: 5 / 8, display: "⅝" },
  { value: 2 / 3, display: "⅔" },
  { value: 3 / 4, display: "¾" },
  { value: 7 / 8, display: "⅞" },
];
const FRACTION_SNAP_TOLERANCE = 0.02;

// Deterministic recipe-quantity formatting: snap close to a common cooking
// fraction, snap close to a whole number, otherwise fall back to a short
// decimal (at most 2 places). Never a general measurement/unit system —
// just avoids ugly output like "0.6666666667" for the cases this module
// itself produces.
export function formatScaledQuantity(value: number): string {
  const whole = Math.floor(value);
  const fractional = value - whole;

  if (fractional >= 1 - FRACTION_SNAP_TOLERANCE) {
    return String(whole + 1);
  }
  if (fractional <= FRACTION_SNAP_TOLERANCE) {
    return String(whole);
  }
  for (const nice of NICE_FRACTIONS) {
    if (Math.abs(fractional - nice.value) <= FRACTION_SNAP_TOLERANCE) {
      return whole > 0 ? `${whole}${nice.display}` : nice.display;
    }
  }

  return String(Math.round(value * 100) / 100);
}

// Scales only the leading quantity of one ingredient line, preserving
// everything after it verbatim. Returns null — meaning "leave this line
// exactly as-is" — for anything that doesn't match a supported quantity
// shape or that looks like a range/compound descriptor/package count.
export function scaleIngredientLine(text: string, factor: number): string | null {
  const match = matchLeadingQuantity(text);
  if (!match) {
    return null;
  }
  const rest = text.slice(match.matchedText.length);
  if (isUnscalableContext(rest)) {
    return null;
  }
  return `${formatScaledQuantity(match.value * factor)}${rest}`;
}

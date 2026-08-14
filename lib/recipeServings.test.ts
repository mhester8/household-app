import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseNumericServings,
  computeScaleFactor,
  formatScaledQuantity,
  scaleIngredientLine,
} from "./recipeServings.ts";

test("parseNumericServings accepts a bare number", () => {
  assert.equal(parseNumericServings("6"), 6);
});

test("parseNumericServings accepts 'N servings'/'N serving'", () => {
  assert.equal(parseNumericServings("6 servings"), 6);
  assert.equal(parseNumericServings("1 serving"), 1);
});

test("parseNumericServings accepts 'Serves N'", () => {
  assert.equal(parseNumericServings("Serves 6"), 6);
  assert.equal(parseNumericServings("SERVES 6"), 6);
});

test("parseNumericServings accepts 'Makes N servings'", () => {
  assert.equal(parseNumericServings("Makes 6 servings"), 6);
});

test("parseNumericServings rejects unusual unit words", () => {
  assert.equal(parseNumericServings("8 bowls"), null);
});

test("parseNumericServings rejects non-numeric multipliers", () => {
  assert.equal(parseNumericServings("1 dozen"), null);
});

test("parseNumericServings rejects ranges", () => {
  assert.equal(parseNumericServings("4-6 servings"), null);
});

test("parseNumericServings rejects vague text", () => {
  assert.equal(parseNumericServings("feeds a crowd"), null);
});

test("parseNumericServings returns null for null/empty input", () => {
  assert.equal(parseNumericServings(null), null);
  assert.equal(parseNumericServings(""), null);
  assert.equal(parseNumericServings("   "), null);
});

test("computeScaleFactor divides desired by original", () => {
  assert.equal(computeScaleFactor(6, 4), 4 / 6);
});

test("computeScaleFactor returns null when nothing would change", () => {
  assert.equal(computeScaleFactor(6, 6), null);
});

test("computeScaleFactor returns null when either value is missing or invalid", () => {
  assert.equal(computeScaleFactor(null, 4), null);
  assert.equal(computeScaleFactor(6, null), null);
  assert.equal(computeScaleFactor(0, 4), null);
  assert.equal(computeScaleFactor(6, -1), null);
});

test("formatScaledQuantity snaps close to common cooking fractions", () => {
  assert.equal(formatScaledQuantity(2 / 3), "⅔");
  assert.equal(formatScaledQuantity(1 + 1 / 3), "1⅓");
  assert.equal(formatScaledQuantity(0.5), "½");
});

test("formatScaledQuantity snaps close to whole numbers", () => {
  assert.equal(formatScaledQuantity(1.995), "2");
  assert.equal(formatScaledQuantity(3.005), "3");
  assert.equal(formatScaledQuantity(4), "4");
});

test("formatScaledQuantity falls back to a short decimal otherwise", () => {
  assert.equal(formatScaledQuantity(1.42857), "1.43");
});

test("formatScaledQuantity picks the closest fraction, not the first within an old tight tolerance", () => {
  // Real values observed from scaling by 1/3 — each ~0.0417 from its
  // nearest candidate, which used to be too far for the old 0.02 window
  // and fell back to an ugly two-decimal value.
  assert.equal(formatScaledQuantity(0.5 / 3), "⅛"); // 0.1667 -> ⅛, not "0.17"
  assert.equal(formatScaledQuantity(1.75 / 3), "⅝"); // 0.5833 -> ⅝, not "0.58"
  assert.equal(formatScaledQuantity(2.5 / 3), "⅞"); // 0.8333 -> ⅞, not "0.83"
  assert.equal(formatScaledQuantity(8 / 3), "2⅔"); // 2.6667 -> 2⅔
});

test("scaleIngredientLine scales a leading integer", () => {
  assert.equal(scaleIngredientLine("2 cups broth", 2 / 3), "1⅓ cups broth");
});

test("scaleIngredientLine scales a leading decimal", () => {
  assert.equal(scaleIngredientLine("1.5 cups broth", 2), "3 cups broth");
});

test("scaleIngredientLine scales a leading ASCII fraction", () => {
  assert.equal(scaleIngredientLine("1/2 cup broth", 2), "1 cup broth");
});

test("scaleIngredientLine scales a leading unicode fraction", () => {
  assert.equal(scaleIngredientLine("½ cup broth", 2), "1 cup broth");
});

test("scaleIngredientLine scales a leading mixed number", () => {
  assert.equal(scaleIngredientLine("1 1/2 cups broth", 2), "3 cups broth");
});

test("scaleIngredientLine real example: ASCII fraction scaled by 1/3", () => {
  assert.equal(scaleIngredientLine("1/2 teaspoon white pepper", 1 / 3), "⅛ teaspoon white pepper");
});

test("scaleIngredientLine real example: mixed number scaled by 1/3", () => {
  assert.equal(scaleIngredientLine("1 3/4 cup self-rising flour", 1 / 3), "⅝ cup self-rising flour");
});

test("scaleIngredientLine real example: another mixed number scaled by 1/3", () => {
  assert.equal(
    scaleIngredientLine("2 1/2 tablespoons melted ghee (or butter)", 1 / 3),
    "⅞ tablespoons melted ghee (or butter)"
  );
});

test("scaleIngredientLine real example: integer scaled by 1/3", () => {
  assert.equal(scaleIngredientLine("8 cups chicken stock or broth", 1 / 3), "2⅔ cups chicken stock or broth");
});

test("scaleIngredientLine leaves a compound 'plus' quantity unscaled", () => {
  assert.equal(scaleIngredientLine("3/4 cup plus 2 tablespoons whole milk", 1 / 3), null);
});

test("scaleIngredientLine leaves a compound 'and' quantity unscaled but not ordinary prose", () => {
  assert.equal(scaleIngredientLine("1 cup and 2 tablespoons flour", 2), null);
  // "and" not immediately followed by a number is just ordinary text.
  assert.equal(
    scaleIngredientLine("5 russet potatoes, peeled and chopped", 2),
    "10 russet potatoes, peeled and chopped"
  );
});

test("scaleIngredientLine leaves a range unscaled", () => {
  assert.equal(scaleIngredientLine("2-3 cloves garlic", 2), null);
  assert.equal(scaleIngredientLine("4 to 6 ounces beef", 2), null);
});

test("scaleIngredientLine leaves a compound descriptor unscaled", () => {
  assert.equal(scaleIngredientLine("1-inch piece ginger", 2), null);
});

test("scaleIngredientLine leaves a competing-quantity parenthetical unscaled", () => {
  assert.equal(scaleIngredientLine("1 (15 oz) can black beans", 2), null);
});

test("scaleIngredientLine leaves package/count words unscaled", () => {
  assert.equal(scaleIngredientLine("1 can black beans", 2), null);
  assert.equal(scaleIngredientLine("2 boxes pasta", 2), null);
});

test("scaleIngredientLine leaves a package word behind a hyphenated size descriptor unscaled", () => {
  assert.equal(scaleIngredientLine("1 15-ounce can pumpkin puree", 2 / 3), null);
  assert.equal(scaleIngredientLine("2 14.5-ounce cans diced tomatoes", 2 / 3), null);
});

test("scaleIngredientLine still scales a hyphenated size descriptor that isn't a package", () => {
  assert.equal(scaleIngredientLine("2 15-inch pizzas", 2), "4 15-inch pizzas");
});

test("scaleIngredientLine leaves a line with no leading quantity unscaled", () => {
  assert.equal(scaleIngredientLine("Salt and pepper to taste", 2), null);
  assert.equal(scaleIngredientLine("Lettuce (finely chopped)", 2), null);
});

test("scaleIngredientLine preserves the rest of the line verbatim", () => {
  assert.equal(scaleIngredientLine("2 tbsp olive oil, divided", 1), "2 tbsp olive oil, divided");
});

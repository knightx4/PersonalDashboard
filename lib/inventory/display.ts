/**
 * Inventory list/detail display helpers.
 * Filters parser noise that should not appear in the subtitle.
 */

const NOISE_VARIANT =
  /^(grand\s*total|order\s*total|order\s*summary|subtotal|shipping|taxes?|total|estimated\s*tax|amount\s*paid)\s*:?\s*$/i;

/** Variant for UI only — drops email-parser leftovers like "Grand Total:". */
export function displayVariant(variant: string | null | undefined): string | null {
  const value = variant?.trim();
  if (!value) return null;
  if (NOISE_VARIANT.test(value)) return null;
  return value;
}

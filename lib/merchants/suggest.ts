/**
 * Matching typed text to merchants on file, for the merchant field on a new
 * order (note b91e07f5).
 */
export interface MerchantOption {
  id: string;
  name: string;
}

/** Enough to pick from without scrolling a wall of shops. */
const MAX_RESULTS = 8;

function normal(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * What the typed text resolves to: a merchant already on file when the name
 * matches one exactly, ignoring case, and a new one otherwise. Empty text is
 * neither, and the order is saved without a merchant, as it was before.
 */
export function resolveMerchant(
  merchants: readonly MerchantOption[],
  text: string,
): { merchantId: string | null; customName: string | null } {
  const needle = normal(text);
  if (!needle) return { merchantId: null, customName: null };
  const known = merchants.find((merchant) => normal(merchant.name) === needle);
  return known
    ? { merchantId: known.id, customName: null }
    : { merchantId: null, customName: text.trim() };
}

/** Names starting with the text first, then names containing it. */
export function suggestMerchants(
  merchants: readonly MerchantOption[],
  text: string,
): MerchantOption[] {
  const needle = normal(text);
  if (!needle) return merchants.slice(0, MAX_RESULTS);
  const starts = merchants.filter((merchant) => normal(merchant.name).startsWith(needle));
  const contains = merchants.filter(
    (merchant) =>
      !normal(merchant.name).startsWith(needle) && normal(merchant.name).includes(needle),
  );
  return [...starts, ...contains].slice(0, MAX_RESULTS);
}

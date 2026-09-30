/**
 * What every watch notification shares (plans #1293, #1294): where it opens,
 * and how a price is written.
 */

/** Where a watch notification opens: the home page's Watching section (#1295). */
export const WATCH_URL = '/home#watching';

/** A value as money: "$186" for dollars, "186 EUR" otherwise. */
export function money(value: number, currency: string | null | undefined): string {
  const amount = Number.isInteger(value) ? String(value) : value.toFixed(2);
  const code = (currency ?? 'USD').toUpperCase();
  return code === 'USD' ? `$${amount}` : `${amount} ${code}`;
}

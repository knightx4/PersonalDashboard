/**
 * Month names for Spending's chart (plan #2593.7), from a YYYY-MM key by
 * arithmetic, so no timezone moves a month across its boundary.
 */

const NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "Oct", the label under a bar. */
export function shortMonth(key: string): string {
  return NAMES[Number(key.slice(5, 7)) - 1].slice(0, 3);
}

/** "October 2026", for the readout. */
export function longMonth(key: string): string {
  return `${NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
}

/**
 * The median month's spending as a share of the chart's top, for the height
 * of an empty month's slot. A third when no month has any.
 */
export function usualSpentShare(months: readonly { spentCents: number }[], high: number): number {
  const shares = months
    .filter((m) => m.spentCents > 0)
    .map((m) => m.spentCents / high)
    .sort((a, b) => a - b);
  return shares.length > 0 ? shares[Math.floor(shares.length / 2)] : 1 / 3;
}

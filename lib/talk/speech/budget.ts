/**
 * The monthly cap on spoken replies (plan #3006.3).
 *
 * Fish Audio's S2.1 Pro model is billed at $15 per million UTF-8 bytes, which
 * is 15 micro-dollars a byte. The person asked for voice to stay under $5 a
 * month, so the month stops at 330,000 bytes: $4.95, about 11,000 a day or
 * 22 replies of 500 characters. core.speech_usage keeps the count, one row a
 * month, and core.reserve_speech_bytes refuses a reply that would pass it.
 */

/** The ledger's model name for Fish Audio's S2.1 Pro, priced in lib/core/spend/pricing.ts. */
export const FISH_S2_1_PRO = 'fish-s2.1-pro';

/** Fish's own name for the model, sent in its `model` header. Never `drama-3`, whose price goes to $50 a million. */
export const FISH_MODEL_HEADER = 's2.1-pro';

/** Bytes a month before voice pauses. */
export const MONTHLY_BYTE_CAP = 330_000;

/** Micro-dollars per byte: $15 per million. */
export const MICROS_PER_BYTE = 15;

/** What a month's bytes cost, in micro-dollars. */
export function speechCostMicros(bytes: number): number {
  return Math.max(0, Math.round(bytes)) * MICROS_PER_BYTE;
}

/** The first day of the month `today` (YYYY-MM-DD, in the account's timezone) falls in. */
export function speechMonth(today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error(`speechMonth wants YYYY-MM-DD, not ${today}`);
  return `${today.slice(0, 7)}-01`;
}

/** Bytes left this month, never below zero. */
export function bytesLeft(used: number, cap: number = MONTHLY_BYTE_CAP): number {
  return Math.max(0, cap - Math.max(0, used));
}

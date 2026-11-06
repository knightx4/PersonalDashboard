/**
 * This month's spoken replies, for the person to read (plan #3006.2).
 *
 * core.speech_usage holds one row per account per month: the UTF-8 bytes sent
 * to Fish Audio and how many replies were spoken. The figure shown is labelled
 * characters, which is what bytes are for English text, and the cost is the
 * same $15 a million the ledger charges, so it agrees with the Spend page's
 * core/speak-reply line for the month.
 */
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { todayInTimezone } from '@/lib/money';
import { MONTHLY_BYTE_CAP, bytesLeft, speechCostMicros, speechMonth } from '@/lib/talk/speech/budget';

export type SpeechUsage = {
  /** The first day of the month, YYYY-MM-DD, in the account's timezone. */
  month: string;
  /** Bytes sent this month. */
  used: number;
  /** Bytes before voice pauses. */
  cap: number;
  left: number;
  replies: number;
  /** What `used` cost, in micro-dollars. */
  costMicros: number;
  /** What the whole cap costs: $4.95. */
  capMicros: number;
  /** True once the month has no room for another reply. */
  paused: boolean;
};

/** The figures for a month from its row, or from nothing when no reply was spoken yet. */
export function speechUsageFrom(month: string, row: { bytes: number; replies: number } | null): SpeechUsage {
  const used = Math.max(0, row?.bytes ?? 0);
  const left = bytesLeft(used);
  return {
    month,
    used,
    cap: MONTHLY_BYTE_CAP,
    left,
    replies: Math.max(0, row?.replies ?? 0),
    costMicros: speechCostMicros(used),
    capMicros: speechCostMicros(MONTHLY_BYTE_CAP),
    paused: left === 0,
  };
}

/** The first day of the month after `month` (YYYY-MM-01), when the count starts again. */
export function speechResetDay(month: string): string {
  const year = Number(month.slice(0, 4));
  const next = Number(month.slice(5, 7)) + 1;
  return next > 12 ? `${year + 1}-01-01` : `${year}-${String(next).padStart(2, '0')}-01`;
}

/**
 * Reads the month's row through the person's core client (RLS lets them read
 * only their own). Null when the read fails, so the page can say so rather
 * than show a month with nothing spoken.
 */
export async function loadSpeechUsage(
  core: CoreSupabaseClient,
  userId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<SpeechUsage | null> {
  const month = speechMonth(todayInTimezone(timezone, now));
  const { data, error } = await core
    .from('speech_usage')
    .select('bytes, replies')
    .eq('user_id', userId)
    .eq('month', month)
    .maybeSingle();
  if (error) return null;
  return speechUsageFrom(month, data as { bytes: number; replies: number } | null);
}

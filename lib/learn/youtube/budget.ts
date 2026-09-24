/**
 * How many TranscriptAPI credits are left, and how many a run may spend.
 *
 * The count comes from `learn.transcript_calls`, the ledger every call writes
 * to, so it covers what this app spent. Calls made elsewhere on the same key,
 * such as the TranscriptAPI connector in a Claude session, are not in it; the
 * TranscriptAPI dashboard is the final word on the balance, and a 402 from the
 * API stops a run whatever this module thinks is left.
 *
 * The month is the calendar month in UTC. TranscriptAPI's billing cycle runs
 * from the day the plan started, which this app has no way to read, so the
 * meter can reset a few days before or after the plan does.
 *
 * Everything here is pure, so the arithmetic is tested without a database.
 */

/** The monthly plan's allowance, when TRANSCRIPTAPI_MONTHLY_CREDITS is unset. */
export const DEFAULT_MONTHLY_CREDITS = 1000;

/** The scheduled run fires this many times a day (supabase/migrations/0101). */
export const SCHEDULED_RUNS_PER_DAY = 4;

/**
 * The most transcripts one scheduled run fetches, whatever the budget allows.
 * A call takes one to five seconds and the route has 300, with the channel
 * re-list and the embedding pass sharing them.
 */
export const MAX_PER_SCHEDULED_RUN = 40;

/**
 * The allowance, from TRANSCRIPTAPI_MONTHLY_CREDITS. Raise it after buying
 * top-up credits; the default is the $5 plan's 1,000.
 */
export function monthlyAllowance(raw: string | undefined = process.env.TRANSCRIPTAPI_MONTHLY_CREDITS): number {
  const parsed = Number.parseInt(raw?.trim() ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MONTHLY_CREDITS;
}

/** Midnight UTC on the first of the month `now` falls in. */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Midnight UTC on the first of the next month. */
export function nextMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export type CreditState = {
  allowance: number;
  used: number;
  remaining: number;
  /** When the meter resets. */
  resetsAt: Date;
};

export function creditState(used: number, allowance: number, now: Date): CreditState {
  return {
    allowance,
    used,
    remaining: Math.max(0, allowance - used),
    resetsAt: nextMonthStart(now),
  };
}

/**
 * Scheduled runs left this month, counting the one happening now.
 *
 * The runs fire at fixed hours, so this counts the whole days left times the
 * runs per day, plus the runs still to come today. Never less than one, so the
 * last run of the month can spend what is left.
 */
export function scheduledRunsLeft(now: Date, runsPerDay: number = SCHEDULED_RUNS_PER_DAY): number {
  const end = nextMonthStart(now).getTime();
  const dayMs = 86_400_000;
  const intervalMs = dayMs / runsPerDay;
  return Math.max(1, Math.ceil((end - now.getTime()) / intervalMs));
}

/**
 * What one scheduled run may spend: an even share of what is left over the
 * runs left, so a long queue is worked through across the month instead of
 * emptying the allowance on the first day and leaving nothing for a press.
 */
export function scheduledRunAllowance(state: CreditState, now: Date): number {
  if (state.remaining <= 0) return 0;
  const share = Math.ceil(state.remaining / scheduledRunsLeft(now));
  return Math.min(MAX_PER_SCHEDULED_RUN, share);
}

/**
 * Where this month's spending is heading, if it carries on at the rate so
 * far. Null in the first day, when a rate means nothing.
 */
export function projectedMonthEnd(state: CreditState, now: Date): number | null {
  const start = monthStart(now).getTime();
  const end = nextMonthStart(now).getTime();
  const elapsed = now.getTime() - start;
  if (elapsed < 86_400_000) return null;
  return Math.round((state.used / elapsed) * (end - start));
}

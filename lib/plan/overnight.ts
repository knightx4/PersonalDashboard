/**
 * The overnight runner's standing intention, and the reading of it.
 *
 * One button before bed starts a night; from then on a cron tick fires one
 * feature at a time and waits for it, until the budget is spent, the stop time
 * passes, nothing assigned to Claude is ready, or you pause it. None of that
 * can live in the page: the tick runs with nobody's tab open, and the answer
 * has to survive the laptop closing. So it is a row -- one per account, in
 * `plan_overnight_runs` (migration 0077) -- and this file is the only thing
 * that writes it.
 *
 * Beside `lib/plan/runs.ts` rather than in it. That file records a press and
 * what Anthropic answered; this one holds the intention that causes the
 * presses. It is deliberately not `server-only`: the page control reads the
 * same row and the same `overnightVerdict` to say what the runner is doing.
 *
 * The reason a night ended is a sentence, not a code, because the morning
 * report reads it back to a person. Two of those sentences are decided here,
 * because they are about this row alone -- the budget and the clock. The rest
 * belong to whoever knows them: the tick says nothing was ready, the page says
 * you stopped it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { elapsedSince } from './elapsed';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public'>;

/** The most features one night may be given. The check constraint agrees. */
export const OVERNIGHT_FEATURE_CAP = 100;

/** The night as the app reads it. One of these per account, or none. */
export type OvernightRun = {
  id: string;
  /** The runner is on. Off is the resting state. */
  running: boolean;
  /** Held by hand, mid-run. The budget and the stop time survive it. */
  paused: boolean;
  /** How many features the night was given when it started. */
  featuresBudget: number;
  /** How many it may still fire. */
  featuresLeft: number;
  /** When it should stop by, whatever is left of the budget. */
  stopBy: string | null;
  /** When the button was pressed. The window the morning report covers. */
  startedAt: string | null;
  /** When a feature was last fired, so the tick knows what is still going. */
  lastFiredAt: string | null;
  endedAt: string | null;
  /** Why it ended, in a sentence. Null on a night that is still going. */
  endedReason: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Every column of the row, so one string is read in one place. */
export const OVERNIGHT_COLUMNS =
  'id, running, paused, features_budget, features_left, stop_by, started_at, ' +
  'last_fired_at, ended_at, ended_reason, created_at, updated_at';

/**
 * A row as the app reads it.
 *
 * PostgREST hands back ISO strings and a direct connection hands back Dates,
 * so one shape leaves here and a script and the page read the same thing --
 * the same defence `planItemFromRow` takes in `load.ts`.
 */
export function overnightRunFromRow(row: Record<string, unknown>): OvernightRun {
  const stamp = (value: unknown): string | null =>
    value instanceof Date ? value.toISOString() : value == null ? null : String(value);
  const budget = Number(row.features_budget ?? 0);
  const left = Number(row.features_left ?? 0);

  return {
    id: row.id as string,
    running: row.running === true,
    paused: row.paused === true,
    featuresBudget: Number.isFinite(budget) ? budget : 0,
    featuresLeft: Number.isFinite(left) ? left : 0,
    stopBy: stamp(row.stop_by),
    startedAt: stamp(row.started_at),
    lastFiredAt: stamp(row.last_fired_at),
    endedAt: stamp(row.ended_at),
    endedReason: (row.ended_reason as string | null) ?? null,
    createdAt: stamp(row.created_at) ?? '',
    updatedAt: stamp(row.updated_at) ?? stamp(row.created_at) ?? '',
  };
}

/**
 * What the tick should do with this row, before it looks at the plan at all.
 *
 * `fire` is the only one that costs anything, and it is the last thing left
 * once the cheap refusals are out of the way. `end` carries the sentence to
 * close the night with; `idle` and `paused` leave the row exactly as it is.
 */
export type OvernightVerdict =
  | { act: 'idle' }
  | { act: 'paused' }
  | { act: 'end'; reason: string }
  | { act: 'fire' };

/** The night ran out of clock. */
export const OVERNIGHT_TIME_UP = 'It reached the time you told it to stop by.';

/** You pressed stop. Written by the page control rather than by the tick. */
export const OVERNIGHT_STOPPED_BY_HAND = 'You stopped it.';

/**
 * Whether the runner may fire another feature, and what to write if not.
 *
 * The order is the point. A night that is over is over whether or not somebody
 * paused it on the way: a paused run past its stop time would otherwise sit
 * there until morning with nothing written on it, and the report would have
 * nothing to read back. So the brakes are checked before the hold.
 *
 * The budget is checked before the clock because it is the more honest answer
 * when both have gone: the night spent what you gave it, and the hour it
 * happened to notice is not what you want read back at breakfast.
 *
 * `now` is a real clock -- the tick's `Date.now()`. Nothing here is rendered
 * from a browser's pre-mount zero; a page draws `running`, `paused` and
 * `endedReason` off the row itself.
 */
export function overnightVerdict(run: OvernightRun | null, now: number): OvernightVerdict {
  if (!run || !run.running) return { act: 'idle' };
  if (run.featuresLeft <= 0) return { act: 'end', reason: budgetSpentReason(run) };
  if (run.stopBy !== null && new Date(run.stopBy).getTime() <= now) {
    return { act: 'end', reason: OVERNIGHT_TIME_UP };
  }
  if (run.paused) return { act: 'paused' };
  return { act: 'fire' };
}

/**
 * The night spent everything it was given, said with the number.
 *
 * The number comes from `featuresBudget` rather than from counting runs,
 * which is what that column is kept for: by the time this is written there is
 * nothing left to count it from.
 */
export function budgetSpentReason(run: Pick<OvernightRun, 'featuresBudget'>): string {
  const n = run.featuresBudget;
  return n === 1
    ? 'It fired the one feature you allowed.'
    : `It fired every one of the ${n} features you allowed.`;
}

/**
 * Which of four things the control on the plan page is looking at.
 *
 * The row carries two booleans and an ended reason, and every question the
 * page asks -- which buttons to offer, which word to print, whether there is a
 * budget worth showing -- is one of these four answers rather than a fresh
 * reading of the booleans in the markup. `off` covers both a fresh account
 * with no row at all and a row nothing has ever run on.
 *
 * A stopped night is `stopped` rather than `off` for as long as its reason is
 * on the row, because "it stopped, and here is why" is a different thing to
 * say than "it is not running" -- and the reason is the whole of what you came
 * to the page for at breakfast.
 */
export type OvernightStanding = 'off' | 'running' | 'paused' | 'stopped';

export function overnightStanding(run: OvernightRun | null): OvernightStanding {
  if (!run) return 'off';
  if (run.running) return run.paused ? 'paused' : 'running';
  return run.endedReason ? 'stopped' : 'off';
}

/**
 * What the runner is doing, in one sentence, for the control to print.
 *
 * The honest limit, and it is worth stating because it is not obvious: a tick
 * that finds the last session still working writes nothing at all, so a
 * running row looks exactly the same whether the cron is ticking away and
 * waiting or has not run since you closed the laptop. Nothing here claims to
 * know which. What it gives instead is the fact that separates them in
 * practice -- how long it is since a feature was fired -- and leaves the
 * reader to notice that four hours of it on a six-feature night means
 * something is wrong. #581. Do not turn this into a claim about the cron
 * without a column that actually records a tick.
 *
 * A stopped night says its reason verbatim, because the five reasons are
 * written as whole sentences precisely so that everything reading them back --
 * this control and the morning report both -- says the same words.
 *
 * `now` of 0 is the clock's pre-mount value, so the sentence that would
 * otherwise carry an elapsed time says the same thing without one rather than
 * changing shape under the reader on hydration.
 */
export function overnightLine(run: OvernightRun | null, now: number): string {
  switch (overnightStanding(run)) {
    case 'off':
      return 'Nothing is fired until you start it.';
    case 'stopped':
      return run?.endedReason ?? '';
    case 'paused':
      return 'Held. Whatever was already building finishes and commits; nothing new is fired until you resume.';
    default:
      break;
  }
  if (!run?.lastFiredAt)
    return 'Nothing has been fired yet. The next tick picks the first feature.';
  return now === 0
    ? 'A feature is already under way. The next one goes once that session has ended.'
    : `It last fired a feature ${elapsedSince(run.lastFiredAt, now)} ago. The next one goes once that session has ended.`;
}

/** What the start form offers before you touch it: a night, and a sleep. */
export const OVERNIGHT_DEFAULT_FEATURES = 6;
export const OVERNIGHT_DEFAULT_HOURS = 8;

/**
 * The lengths of night the control offers, in hours.
 *
 * Hours from now rather than a clock time to stop at, which is the shape the
 * question is asked in ("stop by seven") but not one the app can answer
 * honestly: the server has no idea what "seven" means to a browser it never
 * sees, the profile's timezone is free text people write as "ET", and a
 * bedtime button that is an hour out on the night the clocks change is worse
 * than one that never offered the hour at all. A duration is the same
 * intention with nothing to get wrong, and the row still stores the absolute
 * instant either way.
 *
 * The short ones are for watching it work rather than for a night's sleep.
 */
export const OVERNIGHT_HOUR_CHOICES = [1, 2, 4, 6, 8, 10, 12] as const;

/** The longest a night may be given. Past this it is not an overnight run. */
export const OVERNIGHT_HOUR_CAP = 24;

/**
 * The instant a night of this many hours should stop by.
 *
 * Clamped rather than refused, the same way `startOvernightRun` clamps the
 * budget: a stop time is one of the two brakes the check constraint insists
 * on, and a form that managed to send nonsense should still come out of here
 * with a brake on.
 */
export function overnightStopBy(hours: number, now: number): string {
  const held = Math.min(OVERNIGHT_HOUR_CAP, Math.max(1, Math.trunc(hours) || 1));
  return new Date(now + held * 60 * 60 * 1000).toISOString();
}

/** What a write answers with: the row as it now stands, or why it did not. */
export type OvernightWrite = {
  /** The row after the write, or null when nothing matched it. */
  run: OvernightRun | null;
  error: string | null;
};

/** The account's night, or null when it has never started one. */
export async function loadOvernightRun(supabase: Db, userId: string): Promise<OvernightRun | null> {
  const { data, error } = await supabase
    .from('plan_overnight_runs')
    .select(OVERNIGHT_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.error(`plan_overnight_runs could not be read: ${error.message}`);
    return null;
  }
  return data ? overnightRunFromRow(data as unknown as Record<string, unknown>) : null;
}

/** One shape out of every write, so a caller reads them all the same way. */
function wrote(result: { data: unknown; error: { message: string } | null }): OvernightWrite {
  if (result.error) return { run: null, error: result.error.message };
  return {
    run: result.data
      ? overnightRunFromRow(result.data as unknown as Record<string, unknown>)
      : null,
    error: null,
  };
}

/**
 * Start a night, or start another one over the top of the last.
 *
 * An upsert rather than an insert: the row is the account's, not the night's,
 * so a second press writes the same row and the night before it stops being
 * readable at that moment. Everything the last night left -- what it had left,
 * when it ended and why -- is cleared here, because a half-cleared row is how
 * a finished night comes back to life at three in the morning.
 */
export async function startOvernightRun(input: {
  supabase: Db;
  userId: string;
  /** How many features this night may fire. */
  features: number;
  /** When it should stop by, whatever is left of the budget. */
  stopBy: string | Date;
  now?: Date;
}): Promise<OvernightWrite> {
  const features = Math.max(0, Math.min(OVERNIGHT_FEATURE_CAP, Math.trunc(input.features)));
  const startedAt = (input.now ?? new Date()).toISOString();
  const stopBy = input.stopBy instanceof Date ? input.stopBy.toISOString() : input.stopBy;

  const result = await input.supabase
    .from('plan_overnight_runs')
    .upsert(
      {
        user_id: input.userId,
        running: true,
        paused: false,
        features_budget: features,
        features_left: features,
        stop_by: stopBy,
        started_at: startedAt,
        last_fired_at: null,
        ended_at: null,
        ended_reason: null,
      },
      { onConflict: 'user_id' },
    )
    .select(OVERNIGHT_COLUMNS)
    .maybeSingle();

  return wrote(result);
}

/**
 * Hold the night where it is.
 *
 * Only a running night can be held, which is why the filter is on the write
 * rather than on a read before it: two presses cannot race into a paused row
 * that no night owns. A null row back means there was nothing to pause.
 */
export async function pauseOvernightRun(input: {
  supabase: Db;
  userId: string;
}): Promise<OvernightWrite> {
  const result = await input.supabase
    .from('plan_overnight_runs')
    .update({ paused: true })
    .eq('user_id', input.userId)
    .eq('running', true)
    .select(OVERNIGHT_COLUMNS)
    .maybeSingle();

  return wrote(result);
}

/**
 * Carry on where it was.
 *
 * The budget and the stop time are untouched, so resuming at six in the
 * morning resumes a night that has minutes left rather than starting one that
 * has hours. Whether those minutes are any use is `overnightVerdict`'s answer
 * on the next tick, not this write's.
 */
export async function resumeOvernightRun(input: {
  supabase: Db;
  userId: string;
}): Promise<OvernightWrite> {
  const result = await input.supabase
    .from('plan_overnight_runs')
    .update({ paused: false })
    .eq('user_id', input.userId)
    .eq('running', true)
    .select(OVERNIGHT_COLUMNS)
    .maybeSingle();

  return wrote(result);
}

/**
 * End the night, with the reason it ended.
 *
 * Every way a night finishes comes through here, so there is one place that
 * knows a run that stopped carries a sentence saying why. The `running` filter
 * is what makes the first reason the one that is kept: a tick noticing the
 * clock a second after you pressed stop writes nothing, and the report reads
 * back what actually happened rather than what noticed it last.
 */
export async function stopOvernightRun(input: {
  supabase: Db;
  userId: string;
  /** Why, as a sentence a person reads at breakfast. */
  reason: string;
  now?: Date;
}): Promise<OvernightWrite> {
  const reason = input.reason.trim().slice(0, 500);
  const result = await input.supabase
    .from('plan_overnight_runs')
    .update({
      running: false,
      paused: false,
      ended_at: (input.now ?? new Date()).toISOString(),
      ended_reason: reason.length > 0 ? reason : OVERNIGHT_STOPPED_BY_HAND,
    })
    .eq('user_id', input.userId)
    .eq('running', true)
    .select(OVERNIGHT_COLUMNS)
    .maybeSingle();

  return wrote(result);
}

/**
 * Write down that a feature was just fired.
 *
 * The budget goes down at the fire rather than at the finish: a feature that
 * fell over cost the night the same as one that worked, and a counter that
 * only moves on success is a counter that never stops. The count comes from
 * the row the caller already loaded -- the tick is one at a time, by
 * construction, so there is nobody to race.
 */
export async function recordOvernightFire(input: {
  supabase: Db;
  userId: string;
  /** What the row said was left before this fire. */
  featuresLeft: number;
  now?: Date;
}): Promise<OvernightWrite> {
  const result = await input.supabase
    .from('plan_overnight_runs')
    .update({
      features_left: Math.max(0, input.featuresLeft - 1),
      last_fired_at: (input.now ?? new Date()).toISOString(),
    })
    .eq('user_id', input.userId)
    .eq('running', true)
    .select(OVERNIGHT_COLUMNS)
    .maybeSingle();

  return wrote(result);
}

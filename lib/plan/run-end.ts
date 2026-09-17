/**
 * When a routine run has stopped, and how to say so.
 *
 * `plan_runs` records the press and nothing after it. Every row is written
 * `started` and nothing ever wrote another status, so a run that fell over at
 * lunchtime and one that was fired a minute ago read identically, and the
 * table could not answer the question it exists for.
 *
 * Nothing calls back. A session does not know its own run, and the fire
 * endpoint is not asked again, so the end of a run has to be read off what the
 * app can see: the step the run was sent at closing, and the clock. Both rules
 * are here, pure, so the page and the sweep that writes the rows agree about
 * what "still going" means.
 *
 * Separate from `runs.ts` because that file is server-only and the plan page
 * shows a run's state in the browser.
 */
import { STALLED_AFTER_MINUTES, elapsedSince } from './elapsed';

/** What a run ends as. `started` is the third state, and the one it begins in. */
export type RunEnd = 'finished' | 'failed';
export type RunStatus = 'started' | RunEnd;

/**
 * How long a run may say nothing before it is counted as gone.
 *
 * The same two hours a claim on a step gets, because it is the same question
 * asked from the other side: a session that has not closed its step and has
 * not been heard from since lunchtime is not working, whichever row you read
 * it off.
 */
export const RUN_QUIET_AFTER_MINUTES = STALLED_AFTER_MINUTES;

/** The last run against one step, as the plan page reads it. */
export type LastRun = {
  status: RunStatus;
  createdAt: string;
  /** Why it did not finish. Null on every run that is going or that did. */
  error: string | null;
};

/**
 * What a run that still reads `started` should be written back as, or null
 * while it may still be working.
 *
 * A step closing after the run was fired is the one piece of evidence a
 * session leaves: it was sent at that step, and that step is now closed, so
 * the run did what it was for. Everything else is the clock — past the cutoff
 * with no step closed, nothing has been heard from it and it is not coming
 * back.
 *
 * `now` of 0 is the clock's pre-mount value, so nothing ends at that instant.
 */
export function runEnd(
  run: { status: string; createdAt: string },
  step: { completedAt: string | null } | null,
  now: number,
): RunEnd | null {
  if (run.status !== 'started') return null;
  if (now === 0) return null;

  const fired = new Date(run.createdAt).getTime();
  const closed = step?.completedAt ? new Date(step.completedAt).getTime() : null;
  if (closed !== null && closed >= fired) return 'finished';

  return (now - fired) / 60_000 >= RUN_QUIET_AFTER_MINUTES ? 'failed' : null;
}

/**
 * The reason written on a run the cutoff caught.
 *
 * `failed` is the same status a press that never started gets, so the reason
 * is what tells the two apart: 401 from Anthropic on one, silence on the
 * other. It says how long the silence ran because that is what somebody
 * deciding whether to send the step again wants to know.
 */
export function runQuietNote(createdAt: string, now: number): string {
  return `Nothing was heard from this run for ${elapsedSince(createdAt, now)}.`;
}

/** What the plan page says about the last run against a step. */
export function lastRunLine(run: LastRun, now: number): string {
  if (run.status === 'finished') return 'Last run finished';
  if (run.status === 'failed') {
    return `Last run stopped: ${run.error ?? 'no reason recorded'}`;
  }
  return now === 0 ? 'A run is going' : `A run has been going ${elapsedSince(run.createdAt, now)}`;
}

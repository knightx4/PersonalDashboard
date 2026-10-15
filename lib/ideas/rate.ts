/**
 * How many ideas sessions may file in a day.
 *
 * The duplicate check beside this one (lib/ideas/duplicate.ts) stops the same
 * suggestion arriving twice; it does nothing about many different ones, which
 * is how 53 session-written ideas built up over four days in September. The
 * cap began at two an hour. In the 30 days to 15 October 2026 sessions still
 * filed 147, and 138 sat unread, so the person asked for it to be slowed: now
 * three a day, counting every idea a session filed, the night digest's
 * included. A session that meets the cap has to pick which ideas are worth it.
 *
 * Pure and here rather than in `scripts/plan.ts` so the count and the window
 * are pinned by tests. It applies to what a session files; ideas written on
 * the page are the person's own list and are not counted or capped.
 */

/** Ideas sessions may file inside one window. */
export const IDEA_LIMIT = 3;

/** How far back the count reaches: a day. */
export const IDEA_WINDOW_MINUTES = 24 * 60;

const WINDOW_MS = IDEA_WINDOW_MINUTES * 60_000;

/** Whether another idea may be filed, and when it may be if not. */
export interface IdeaAllowance {
  allowed: boolean;
  /** Session-filed ideas inside the window, counting no further than the cap. */
  filed: number;
  /** When the count drops below the cap, in epoch ms. Null while under it. */
  freeAt: number | null;
}

/**
 * The cap read against what has already been filed.
 *
 * `filedAt` is the moment each session-written idea was inserted, in epoch
 * ms and in any order; anything older than the window is ignored. An idea
 * that was later shaped into the plan or dismissed still counts, because the
 * cap is on writing to the list rather than on what is left on it.
 */
export function ideaAllowance(filedAt: readonly number[], now: number): IdeaAllowance {
  const inWindow = filedAt.filter((at) => now - at < WINDOW_MS).sort((a, b) => b - a);
  if (inWindow.length < IDEA_LIMIT) {
    return { allowed: true, filed: inWindow.length, freeAt: null };
  }
  // The cap lifts when the oldest of the last IDEA_LIMIT falls out of the window.
  return { allowed: false, filed: inWindow.length, freeAt: inWindow[IDEA_LIMIT - 1] + WINDOW_MS };
}

/** A wait as "40m" under two hours and "5h" from there, rounded up. */
function waitText(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return minutes < 120 ? `${minutes}m` : `${Math.ceil(minutes / 60)}h`;
}

/**
 * The refusal, written so a session can report it as it stands.
 *
 * It says how long the wait is rather than the hour it ends, because the run
 * reading it has no timezone and the person reading the run wants the wait.
 */
export function ideaCapRefusal(allowance: IdeaAllowance, now: number): string {
  const wait = allowance.freeAt ? waitText(allowance.freeAt - now) : '1m';
  return (
    `${allowance.filed} ideas already filed by sessions in the last day, which is the cap ` +
    `(${IDEA_LIMIT} a day). The next can be filed in ${wait}.`
  );
}

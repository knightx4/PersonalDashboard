/**
 * How many ideas a session may file in an hour.
 *
 * The duplicate check beside this one (lib/ideas/duplicate.ts) stops the same
 * suggestion arriving twice; it does nothing about ten different ones from a
 * single run, which is the other half of how 53 session-written ideas built
 * up over four days. The list is only useful if it can be read in one
 * sitting, so a session gets two an hour and has to pick which two.
 *
 * Pure and here rather than in `scripts/plan.ts` so the count and the window
 * are pinned by tests. It applies to what a session files; ideas written on
 * the page are the person's own list and are not counted or capped.
 */

/** Ideas a session may file inside one window. */
export const IDEA_LIMIT = 2;

/** How far back the count reaches. */
export const IDEA_WINDOW_MINUTES = 60;

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

/**
 * The refusal, written so a session can report it as it stands.
 *
 * It says how long the wait is rather than the hour it ends, because the run
 * reading it has no timezone and the person reading the run wants the wait.
 */
export function ideaCapRefusal(allowance: IdeaAllowance, now: number): string {
  const minutes = allowance.freeAt ? Math.max(1, Math.ceil((allowance.freeAt - now) / 60_000)) : 0;
  return (
    `${allowance.filed} ideas already filed in the last hour, which is the cap ` +
    `(${IDEA_LIMIT} an hour from a session). The next can be filed in ${minutes}m.`
  );
}

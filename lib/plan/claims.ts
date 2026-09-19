/**
 * When a claim on a step has stopped meaning anything.
 *
 * `in_progress` says one thing: a session has claimed this step and is on it.
 * Nothing releases it when that session dies, so the row goes on saying
 * underway for the rest of the day -- and the CLI, the brief and the next
 * session all read the row. `lib/plan/elapsed.ts` already reads the clock
 * beside the status so the page and the send guard stop calling a dead claim
 * live; this is the half that says a claim should be written back, so the row
 * itself stops being wrong.
 *
 * One rule decides: the claim is older than any session takes, which is
 * `isStalledClaim`'s and the same threshold. There was a second until #714 --
 * a claim with no assignee was read as one nobody was holding, because every
 * path that claimed a step wrote who held it. Those writes are gone, so an
 * empty column no longer says anything about whether a session is on the step,
 * and the sweep reads the run behind the claim for that.
 */
import { elapsedSince, isStalledClaim } from './elapsed';

export type Claim = {
  status: string;
  startedAt: string | null;
};

/** Why a claim is being taken back. */
export type ExpiredClaim = 'stale';

/**
 * Whether this row's claim should be put back.
 *
 * Null for anything that is not a claim at all, and for a live one. A claim
 * with no `startedAt` is left alone the way `claimLiveness` leaves it: the
 * column is stamped by a trigger, so a row without one was claimed this
 * instant.
 */
export function expiredClaim(claim: Claim, now: number): ExpiredClaim | null {
  if (claim.status !== 'in_progress') return null;
  if (!claim.startedAt) return null;
  return isStalledClaim(claim.startedAt, now) ? 'stale' : null;
}

/**
 * The line written into the step's comment when its claim is taken back.
 *
 * Dated and appended, the same shape `done`, `block` and `answer` use, so the
 * history of a step reads in one column however each line got there. It says
 * how long the claim sat because that is the question somebody reading it a
 * week later asks: whether the session had time to do anything first.
 *
 * `refusal` is what GitHub said when it could not be asked what the run behind
 * the claim had pushed. The clock takes the claim back either way, and #682 is
 * that the line has to say which of the two happened: a claim released against
 * the evidence -- GitHub answered, and the run had pushed nothing -- reads
 * identically to one released with no evidence at all, and only the second is
 * a reason to go and look at the token.
 */
export function claimExpiredNote(
  startedAt: string,
  now: number,
  refusal: string | null = null,
): string {
  const stamp = new Date(now).toISOString().slice(0, 10);
  const line =
    `Claim expired ${stamp}: nothing had touched it for ${elapsedSince(startedAt, now)}, ` +
    'so it went back to not started.';
  if (!refusal) return line;

  const said = refusal.trim();
  return `${line} GitHub could not be asked what its run pushed, so the clock decided alone. ${
    said.endsWith('.') ? said : `${said}.`
  }`;
}

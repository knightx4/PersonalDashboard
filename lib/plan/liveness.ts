/**
 * Whether the session a run started is still working, read off what it pushed.
 *
 * A run is fired and then says nothing. `run-end.ts` answers the same question
 * from the clock alone -- two hours with the step still open and the run is
 * called gone -- which calls a long batch dead while it is working and calls a
 * session that fell over on its first step alive for the rest of the
 * afternoon. #495 settled the signal as commits, because a session that is
 * working pushes, and #522 settled which commits: every branch that moved
 * since the run started, not main alone, since a session pushes to a branch
 * the harness names for it and only merges at the end.
 *
 * So the evidence is one listing of the repository's activity, and the rules
 * for turning it into a word are here. Pure and separate from the fetching for
 * the same reason `checks.ts` is separate from `ci.ts`: the request is
 * server-only and the page draws the answer in the browser.
 *
 * Blind for the first few minutes of a run, which is the cost #495 accepted:
 * nothing has been pushed yet, so a run that started two minutes ago and one
 * that died two minutes in read the same. The quiet mark is what separates
 * them, at twenty minutes.
 */
import { elapsedSince, isStalledClaim } from './elapsed';
import { RUN_QUIET_AFTER_MINUTES, type StoredRunReading } from './run-end';

/**
 * Nothing pushed for this long and the run is shown as quiet. #524.
 *
 * Longer than the gap between two commits inside a batch, and short enough to
 * catch a session that died on its first step the same hour. A run reading a
 * lot of files or waiting on a build will read quiet while it is working;
 * that is the trade the mark was chosen with.
 */
export const QUIET_AFTER_MINUTES = 20;

/**
 * Nothing pushed for this long and the run is counted as over. #524.
 *
 * The two hours `run-end.ts` already ends a run on and `claims.ts` already
 * takes a claim back on, under the name it has there. Same number, so the
 * evidence and the clock do not disagree about when a run is gone.
 */
export const ENDED_AFTER_MINUTES = RUN_QUIET_AFTER_MINUTES;

/**
 * What a run is doing.
 *
 * `finished` is the one state that is not read off pushes: the step the run
 * was sent at closed after it was fired, which is the thing a session leaves
 * behind when it does what it was for. `ended` is the other side of that --
 * silence past the mark with the step still open. `unknown` is for when
 * GitHub could not be asked at all, and it matters that it is its own word:
 * silence the app could not hear is not evidence of anything.
 */
export type RunLiveness = 'working' | 'quiet' | 'ended' | 'finished' | 'unknown';

/** One branch moving, as the activity listing reports it. */
export type Push = {
  /** The branch, without the `refs/heads/` in front of it. */
  ref: string;
  /** What the branch points at after the push. */
  sha: string;
  at: string;
};

/** One entry from GitHub's repository activity listing. */
export type ActivityRow = {
  activity_type?: string;
  ref?: string;
  after?: string;
  timestamp?: string;
};

/**
 * The activity types that mean a branch moved forward.
 *
 * `branch_creation` is in here because it is how a session's first push shows
 * up: the branch did not exist, so pushing it is recorded as creating it
 * rather than as a push, and leaving it out would make every run look silent
 * until its second commit. `branch_deletion` is left out because it moves
 * nothing forward -- it is the harness tidying up after a merge.
 */
const MOVED: ReadonlySet<string> = new Set([
  'push',
  'force_push',
  'branch_creation',
  'pr_merge',
  'merge_queue_merge',
]);

/** What a run's liveness is read from. */
export type RunEvidence = {
  /** When the run was fired. */
  startedAt: string;
  /** The newest push since then, or null when there has been none. */
  lastPush: Push | null;
  /** When the step the run was sent at closed, if it has. */
  stepClosedAt: string | null;
  /** False when GitHub could not be asked, so silence proves nothing. */
  read: boolean;
};

/** The pushes in a listing, newest first, from the given instant onwards. */
export function pushesFrom(rows: readonly ActivityRow[], since: number): Push[] {
  const pushes: Push[] = [];
  for (const row of rows) {
    if (!row.timestamp || !row.ref) continue;
    if (!MOVED.has(row.activity_type ?? '')) continue;
    const at = new Date(row.timestamp).getTime();
    if (!Number.isFinite(at) || at < since) continue;
    pushes.push({
      ref: row.ref.replace(/^refs\/heads\//, ''),
      sha: row.after ?? '',
      at: row.timestamp,
    });
  }
  return pushes.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

/** The newest push at or after the instant a run started, of a listing's. */
export function lastPushSince(pushes: readonly Push[], startedAt: string): Push | null {
  const fired = new Date(startedAt).getTime();
  let newest: Push | null = null;
  for (const push of pushes) {
    const at = new Date(push.at).getTime();
    if (!Number.isFinite(at) || at < fired) continue;
    if (!newest || at > new Date(newest.at).getTime()) newest = push;
  }
  return newest;
}

/**
 * How long a run has been silent, in minutes.
 *
 * Counted from its last push, or from when it started if it has not pushed --
 * which is the half of #524 that is easy to get wrong. Counting from the press
 * instead would call every long batch quiet twenty minutes in, whatever it had
 * done since.
 */
function silentFor(startedAt: string, lastPushAt: string | null, now: number): number {
  const fired = new Date(startedAt).getTime();
  const pushed = lastPushAt ? new Date(lastPushAt).getTime() : 0;
  return (now - Math.max(fired, pushed)) / 60_000;
}

/**
 * The word for a run that has pushed nothing for this long.
 *
 * The two marks #524 set, applied in one place. `runLiveness` reads them off a
 * fresh listing and `claimLiveness` reads them off the stored reading on the
 * run row, and a second copy of the comparison is the first thing to drift
 * when one of the numbers changes.
 */
export function silenceReads(minutes: number): 'working' | 'quiet' | 'ended' {
  if (minutes >= ENDED_AFTER_MINUTES) return 'ended';
  if (minutes >= QUIET_AFTER_MINUTES) return 'quiet';
  return 'working';
}

/**
 * What a run is doing, from the pushes since it started.
 *
 * The step closing is checked before anything else: a run that did what it was
 * sent for is finished whether or not it pushed afterwards, and a step closed
 * before the run was fired belongs to an earlier run and says nothing about
 * this one.
 *
 * `now` of 0 is the clock's pre-mount value, so nothing ages at that instant
 * and the server and the first client render agree -- the same rule
 * `isStalledClaim` and `runEnd` follow.
 */
export function runLiveness(evidence: RunEvidence, now: number): RunLiveness {
  const fired = new Date(evidence.startedAt).getTime();
  const closed = evidence.stepClosedAt ? new Date(evidence.stepClosedAt).getTime() : null;
  if (closed !== null && closed >= fired) return 'finished';

  if (!evidence.read) return 'unknown';
  if (now === 0) return 'working';

  return silenceReads(silentFor(evidence.startedAt, evidence.lastPush?.at ?? null, now));
}

/**
 * Whether a step's claim is one a run ended without closing.
 *
 * The case the plan page could not name before: the row says `in_progress`,
 * nobody is working it, and the step was never closed. `ended` already means
 * the step did not close -- `runLiveness` answers `finished` when it did -- so
 * this is only asking whether the claim is still standing.
 */
export function abandonedClaim(step: { status: string } | null, liveness: RunLiveness): boolean {
  return step?.status === 'in_progress' && liveness === 'ended';
}

/* -------------------------------------------------------------------------
 * A claim on a step, read off the run behind it
 * ---------------------------------------------------------------------- */

/**
 * What a claim on a step means right now.
 *
 * `in_progress` is a claim written when the step was handed over and nothing
 * clears it when the session holding it dies, so the column alone cannot say
 * which of these four a row is. Every surface asks this instead, and they
 * agree because there is one answer:
 *
 *  - `claimed` -- the row says a session has it and nothing says what that
 *    session is doing. No run recorded, or one nobody has asked GitHub about,
 *    and the clock has not run out either.
 *  - `working` -- its run has pushed something recently enough.
 *  - `quiet` -- nothing pushed for `QUIET_AFTER_MINUTES`. It may still be
 *    reading files or waiting on a build; that is the trade #524 took.
 *  - `abandoned` -- past `ENDED_AFTER_MINUTES` with the step still open. The
 *    case the page could not name before: nobody is on it and it was never
 *    closed.
 *
 * `claimed` rather than null for the no-evidence case, because null has to
 * mean one thing and it means "not a claim at all".
 */
export type ClaimLiveness = 'claimed' | 'working' | 'quiet' | 'abandoned';

/** Enough of a step for the rule: the claim, and when it was made. */
export type ClaimStep = { status: string; startedAt: string | null };

/**
 * Enough of the last run against it.
 *
 * `LastRun` in `run-end.ts` satisfies this, which is what the page, the guard
 * and the CLI all hand over. Written structurally so nothing here has to
 * import the loader that produces it.
 */
export type ClaimRun = {
  status: string;
  createdAt: string;
  reading: StoredRunReading | null;
};

/**
 * How old a stored reading may be and still be believed. #570.
 *
 * The mark a run is counted as over on. Nothing is gained by repeating a
 * reading older than the point at which the run it describes would have ended
 * anyway, and a surface that cannot refresh it falls back to the clock in
 * `elapsed.ts` rather than reporting something nobody has checked since
 * breakfast.
 */
export const READING_TRUSTED_FOR_MINUTES = ENDED_AFTER_MINUTES;

/**
 * Whether the reading stored on a run row may be read as evidence.
 *
 * A refusal is not evidence of anything: a rejected or missing key makes every
 * run look as though it pushed nothing, which is how the wrong credential went
 * unnoticed for days. So a reading carrying one is set aside here and the
 * clock answers instead; saying *that* GitHub refused is #566's, on the run
 * row where the reason is kept.
 *
 * `now` of 0 is the clock's pre-mount value, so nothing has aged at that
 * instant -- the same rule the rest of this file follows.
 */
export function readingTrusted(reading: StoredRunReading, now: number): boolean {
  if (reading.refusal) return false;
  return readingIsFresh(reading, now);
}

/**
 * Whether a reading was taken recently enough to describe the run now.
 *
 * The age half of `readingTrusted`, on its own because a refusal fails that
 * test on its own account and still has to be dated. `now` of 0 is the
 * clock's pre-mount value, so nothing has aged at that instant.
 */
function readingIsFresh(reading: StoredRunReading, now: number): boolean {
  if (now === 0) return true;
  return (now - new Date(reading.checkedAt).getTime()) / 60_000 < READING_TRUSTED_FOR_MINUTES;
}

/**
 * The refusal on a reading, while it is still the state of the key.
 *
 * `readingTrusted` sets a refusal aside so the silence behind it is never read
 * as working, quiet or stopped. This is the other half of that -- saying so --
 * and #566 is where it gets said.
 *
 * Age matters here in a way it does not for the silence. A refusal recorded
 * before the trusted mark is a run nothing has asked about since, and the key
 * may well have been replaced in the meantime; a page still telling somebody
 * to set a token that already works is worse than one saying nothing. So the
 * same freshness mark #570 set applies, and an older refusal stays where it
 * is on the run row as that run's record.
 */
export function refusalStanding(
  reading: StoredRunReading | null | undefined,
  now: number,
): string | null {
  if (!reading?.refusal) return null;
  return readingIsFresh(reading, now) ? reading.refusal : null;
}

/**
 * What the claim on a step reads as, from the last run against it.
 *
 * Null when the row is not claimed at all, so a caller can tell "nobody has
 * this" from "somebody has it and we cannot say more".
 *
 * The run is only evidence while it is still `started`. One written off as
 * `failed` has already been counted as over -- by the sweep, or by the two
 * hours in `runEnd` -- and a claim standing over it is abandoned by
 * definition. A `finished` run is not evidence either: it did what it was for,
 * so whatever is claiming this row now is something the run says nothing
 * about, and the clock answers.
 */
export function claimLiveness(
  step: ClaimStep,
  run: ClaimRun | null | undefined,
  now: number,
): ClaimLiveness | null {
  if (step.status !== 'in_progress') return null;

  if (run?.status === 'failed') return 'abandoned';

  const reading = run?.status === 'started' ? run.reading : null;
  if (run && reading && readingTrusted(reading, now)) {
    if (now === 0) return 'working';
    const reads = silenceReads(silentFor(run.createdAt, reading.lastPush?.at ?? null, now));
    return reads === 'ended' ? 'abandoned' : reads;
  }

  // Nothing to read, so the clock. The two-hour reading in `elapsed.ts` was
  // the whole of this signal before GitHub could be asked, and it stays as the
  // fallback for a claim with no run recorded, a run nobody has asked about
  // and a reading too old to trust. A claim with no `startedAt` is left alone
  // the way the guard has always left it: the column is stamped by a trigger,
  // so a row without one was claimed this instant.
  const since = step.startedAt ?? run?.createdAt ?? null;
  if (!since) return 'claimed';
  return isStalledClaim(since, now) ? 'abandoned' : 'claimed';
}

/**
 * Whether a claim is one a session may still be on.
 *
 * What the guards ask. `quiet` counts as live: the mark is known to read wrong
 * on a run that is reading files or waiting on a build, and #574 settled that
 * a quiet step is re-sent by asking first rather than by the guard letting it
 * through on its own.
 */
export function claimIsLive(liveness: ClaimLiveness | null): boolean {
  return liveness !== null && liveness !== 'abandoned';
}

/**
 * One word for a claim, where there is only room for one.
 *
 * The terminal's facts column, which has about ten characters. The page has
 * room for its own wording beside the other healths and the brief writes a
 * sentence, but all three describe the same four readings, so this is what
 * anything terse says rather than a fourth set of words.
 */
export const CLAIM_WORD: Record<ClaimLiveness, string> = {
  claimed: 'claimed',
  working: 'pushing',
  quiet: 'quiet',
  abandoned: 'stopped',
};

/**
 * Why a run was counted as over, for the reason kept on the run row.
 *
 * Says what was last seen rather than only how long the silence ran, because
 * the question somebody asks about a run that stopped is whether it got
 * anything done first.
 */
export function runEndedNote(evidence: RunEvidence, now: number): string {
  const silence = elapsedSince(evidence.lastPush ? evidence.lastPush.at : evidence.startedAt, now);
  if (!evidence.lastPush) {
    return `Nothing was pushed in the ${silence} after this run started.`;
  }
  return `Nothing has been pushed for ${silence}. The last was ${evidence.lastPush.ref}.`;
}

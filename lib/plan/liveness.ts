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
import { endsRun, RUN_QUIET_AFTER_MINUTES, type StoredRunReading } from './run-end';

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
 * How long a run that has produced *nothing* may go before it is counted as
 * gone.
 *
 * `ENDED_AFTER_MINUTES` is two hours because a session that is working can go
 * quiet for a long stretch between pushes and firing a second one at the same
 * feature is worse than waiting. A session that has pushed nothing at all
 * since it was fired is a different claim: it has not created its branch, not
 * committed, not closed a step. Nothing it did would be lost by giving up on
 * it.
 *
 * Thirty minutes because the evidence is not close. `listPushes` reads the
 * repository's activity across every ref, so a session shows up the moment it
 * creates its branch -- and the sessions that worked took seven to eleven
 * minutes to their first push. The one that stalled the runner for 2h07m on
 * 18 September never pushed at all, and its step was still `not_started` when
 * the claim was swept.
 */
export const NO_OUTPUT_AFTER_MINUTES = 30;

/**
 * How long a feature run may leave its own part of the plan untouched, with
 * no step under it claimed, before it is counted as over.
 *
 * The push readings cannot answer this on their own. `listPushes` reads the
 * whole repository's activity, so any other session pushing anywhere reads as
 * this run still working. On 22 September the session on #723 wrote a setup
 * step at 22:07 and stopped, and the runner kept waiting because other
 * sessions went on pushing to main.
 *
 * A session working a feature always has a trail on the feature's own rows:
 * it claims a step before building it (`plan.ts start`) and closes or blocks
 * it after. So no claim under the feature and no change to any row beneath it
 * for this long means nobody is working it, whatever else the repository is
 * doing. Twenty minutes covers the gap between closing one step and claiming
 * the next, which is a merge and a subagent starting up.
 */
export const FEATURE_IDLE_AFTER_MINUTES = 20;

/** What a feature's rows say about the session sent to build it. */
export type FeatureTrail = {
  /** Whether any step beneath the feature is claimed right now. */
  claimed: boolean;
  /**
   * Whether the row the run was sent at is itself done or dropped. A session
   * closes its feature, or its one step, as the last thing it does, so there
   * is nothing left to wait out.
   */
  closed?: boolean;
  /** The newest change to the feature or any row beneath it. */
  touchedAt: string | null;
};

/**
 * Whether a feature run has gone idle on its own rows: nothing claimed, and
 * nothing changed since the run started or since its last change, for
 * `FEATURE_IDLE_AFTER_MINUTES`. False at `now === 0`, like every clock rule
 * here.
 *
 * A run whose own row is closed is idle at once. The twenty minutes are for
 * the gap between one step and the next, and a closed row has no next. On 25
 * September the runner fired steps one at a time and waited the full twenty
 * minutes after each had closed, which was two thirds of every step's time.
 */
export function featureRunIdle(startedAt: string, trail: FeatureTrail, now: number): boolean {
  if (now === 0 || trail.claimed) return false;
  if (trail.closed) return true;
  const fired = new Date(startedAt).getTime();
  const touched = trail.touchedAt ? new Date(trail.touchedAt).getTime() : 0;
  const last = Math.max(fired, Number.isFinite(touched) ? touched : 0);
  return (now - last) / 60_000 >= FEATURE_IDLE_AFTER_MINUTES;
}

/**
 * Whether a feature's session is between one step and the next: its newest run
 * is a feature run still marked started, nothing under the feature is claimed,
 * and something beneath it changed within `FEATURE_IDLE_AFTER_MINUTES`.
 *
 * The send guards refuse a live claim, and a session sent at a feature holds
 * one only while it builds a step. From closing that step to claiming the next
 * it holds none, and a press in that gap started a second session on the same
 * feature: the overnight tick did it to #866 on 23 September, 21 seconds after
 * #868 closed. The overnight runner reads the same gap through
 * `featureRunIdle`; this is that rule for the buttons.
 */
export function featureBetweenSteps(
  steps: readonly { updatedAt: string }[],
  run: { status: string; createdAt: string; job: string } | undefined,
  now: number,
): boolean {
  if (!run || run.job !== 'feature' || run.status !== 'started') return false;
  let touchedAt: string | null = null;
  for (const step of steps) {
    if (!touchedAt || new Date(step.updatedAt) > new Date(touchedAt)) touchedAt = step.updatedAt;
  }
  return !featureRunIdle(run.createdAt, { claimed: false, touchedAt }, now);
}

/** The refusal for a press that lands between a feature session's steps. */
export function betweenStepsRefusal(feature: { number: number }): string {
  return (
    `#${feature.number} has a session working through its steps, between one and the next. ` +
    `Wait for it to finish, or send again once nothing under #${feature.number} has changed ` +
    `for ${FEATURE_IDLE_AFTER_MINUTES} minutes.`
  );
}

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

/**
 * A push as the run row remembers it: when, which commit, and what it said.
 *
 * The push half of `StoredRunReading`, named so that a surface drawing one does
 * not have to spell the nullable field out. Here rather than beside the request
 * that fills it in, for the reason the whole of this file is here: `ci.ts` is
 * server-only and the plan page draws the answer in the browser, so the shape
 * it draws has to live on the browser-safe side of the pair.
 */
export type StoredPush = NonNullable<StoredRunReading['lastPush']>;

/** Longest a commit subject is printed at before it is cut. */
export const SUBJECT_LIMIT = 90;

/**
 * The first line of a commit message, as a row can print it.
 *
 * A commit message is a subject, a blank line and a body, and only the subject
 * says what the commit was -- the body is the reasoning, and on this project it
 * runs to paragraphs. Cut at a word rather than mid-word, and with an ellipsis,
 * so a long subject reads as cut rather than as a subject that stops oddly.
 */
export function commitSubject(message: string): string | null {
  const first = message.split('\n', 1)[0]?.replace(/\s+/g, ' ').trim() ?? '';
  if (first.length === 0) return null;
  if (first.length <= SUBJECT_LIMIT) return first;
  const cut = first.slice(0, SUBJECT_LIMIT);
  const space = cut.lastIndexOf(' ');
  return `${(space > SUBJECT_LIMIT / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

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
  /**
   * When that step became blocked, if it did. #679.
   *
   * The other way a session ends: it did the work it could and wrote down the
   * question it cannot answer. Nothing closes, so the close above stays null
   * and the run used to fall through to the silence rules for the rest of the
   * no-output mark with nobody behind it.
   *
   * Null is "no block since this run was fired", which is also what the three
   * steps blocked before #678 stamped the column say.
   */
  stepBlockedAt: string | null;
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
 * The newest push any of these runs is recorded as having made since an
 * instant.
 *
 * What the Overnight card prints, read off the readings #568 stores on the run
 * rows rather than asked of GitHub while the page renders. #569's route is the
 * one thing that asks, on the loop the page starts after it has drawn, so this
 * is the same reading every other surface is looking at and it costs the render
 * nothing.
 *
 * Across the runs rather than one of them, because a night fires a run per
 * feature and the question is what the *night* last pushed. A refusal carries
 * no push (`readingFor`), so a run GitHub would not answer for simply has
 * nothing to offer here and the next one down answers instead; saying that the
 * key is being refused is `keyRefusal`'s, said once above the plan.
 */
export function lastStoredPush(
  runs: Iterable<{ reading: StoredRunReading | null }>,
  since: string,
): StoredPush | null {
  const from = new Date(since).getTime();
  let newest: StoredPush | null = null;
  for (const run of runs) {
    const push = run.reading?.lastPush;
    if (!push) continue;
    const at = new Date(push.at).getTime();
    if (!Number.isFinite(at) || at < from) continue;
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
 * What the step did is checked before anything else: a run that did what it
 * was sent for is finished whether or not it pushed afterwards, and a stamp
 * from before the run was fired belongs to an earlier run and says nothing
 * about this one.
 *
 * A block counts as the end of the run the same way a close does. #679. A
 * session that stops to ask a question has finished with the step -- it wrote
 * the ask on the row, and no more work comes from it until somebody answers --
 * so treating that as silence left the runner waiting out the no-output mark
 * on a session that had already gone.
 *
 * `now` of 0 is the clock's pre-mount value, so nothing ages at that instant
 * and the server and the first client render agree -- the same rule
 * `isStalledClaim` and `runEnd` follow.
 */
export function runLiveness(evidence: RunEvidence, now: number): RunLiveness {
  const fired = new Date(evidence.startedAt).getTime();
  if (endsRun(evidence.stepClosedAt, evidence.startedAt)) return 'finished';
  if (endsRun(evidence.stepBlockedAt, evidence.startedAt)) return 'finished';

  if (!evidence.read) return 'unknown';
  if (now === 0) return 'working';

  // Nothing on any ref since it was fired. Judged sooner than silence between
  // pushes, because it is a stronger fact: this run never started.
  if (!evidence.lastPush && (now - fired) / 60_000 >= NO_OUTPUT_AFTER_MINUTES) return 'ended';

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

/* -------------------------------------------------------------------------
 * Sending a step again while its run is quiet
 * ---------------------------------------------------------------------- */

/**
 * Enough of a run to say what it last did.
 *
 * `LastRun` satisfies it, which is what the guard, the page and the menu all
 * hand over. Narrower than `ClaimRun` because saying what a run pushed does
 * not depend on whether it is still counted as going -- `claimLiveness` has
 * already settled that by the time anything here is asked.
 */
export type QuietRun = Pick<ClaimRun, 'createdAt' | 'reading'>;

/** A commit named short, the length everything else on this page names one. */
const SHORT_SHA = 7;

/**
 * What a quiet run last did, in a sentence.
 *
 * Two facts, because they are the two somebody deciding whether to send the
 * step again actually has: how long the silence has run, and what the last
 * push was. A run that never pushed at all gets the silence counted from the
 * press instead, which is the same rule `silentFor` reads the mark off -- so
 * the sentence and the word above it cannot disagree about how long it has
 * been.
 *
 * The subject when there is one, the short sha when the push was recorded
 * without it, and nothing when neither was: a sentence trailing off into an
 * empty pair of quotes says less than one that stops.
 */
export function quietRunNote(run: QuietRun, now: number): string {
  const push = run.reading?.lastPush ?? null;
  if (!push) {
    return `Nothing has been pushed in the ${elapsedSince(run.createdAt, now)} since it started.`;
  }

  const silence = `Nothing has been pushed for ${elapsedSince(push.at, now)}.`;
  if (push.subject) return `${silence} The last was "${push.subject}".`;
  if (push.sha) return `${silence} The last was ${push.sha.slice(0, SHORT_SHA)}.`;
  return silence;
}

/**
 * The question put before a step whose run has gone quiet is sent again. #574.
 *
 * You chose to be asked rather than refused, so this is the asking, and it
 * carries the evidence rather than only the verdict: the twenty-minute mark is
 * known to read wrong on a session that is reading files or waiting on a
 * build, and "its run is quiet" on its own gives you nothing to tell those two
 * cases apart.
 */
export function quietSendAsk(number: number, run: QuietRun, now: number): string {
  return (
    `#${number} is underway and its run has gone quiet. ${quietRunNote(run, now)} ` +
    'Hand it to a fresh session?'
  );
}

/**
 * The reason written on the run a confirmed send replaced.
 *
 * Without it the row goes on saying `started` until the two hours are up, so
 * the page would draw a fresh session's claim over a run still reading as
 * going and `claimLiveness` would read the older of the two. It says what was
 * last seen of the run as well as that it was replaced, because that is the
 * record of what the run managed before somebody gave up on it.
 */
export function runReplacedNote(run: QuietRun, now: number): string {
  return `The step was handed to a fresh session while this run was quiet. ${quietRunNote(run, now)}`;
}

/**
 * What pressing Send on a step does, given what its claim reads as.
 *
 * The whole of #574's answer, in one place, because the guard in
 * `handover.ts`, the button on the plan page and the item in the row menu all
 * have to agree about which press gets asked about: a page that arms a
 * confirmation the guard then refuses outright, or sends without asking what
 * the guard would have asked about, is worse than either rule on its own.
 *
 *  - Nothing claiming it, or a claim whose run has stopped, goes straight
 *    through -- which is what happens today.
 *  - A quiet run is asked about, and the same press carrying `confirmed` goes
 *    through.
 *  - Anything else is refused, and that is the refusal the button has always
 *    given.
 *
 * A quiet reading with no run to describe cannot happen -- `claimLiveness`
 * only answers `quiet` off a run's stored reading -- but it is refused rather
 * than sent if it ever does, because an ask with no evidence in it is just a
 * press with an extra step in front of it.
 */
export type SendOverClaim =
  | { send: true }
  | {
      send: false;
      /** What to say, whether it is a question or a refusal. */
      ask: string;
      /** Whether pressing again with `confirmed` would go through. */
      confirmable: boolean;
    };

export function sendOverClaim(input: {
  number: number;
  liveness: ClaimLiveness | null;
  run: QuietRun | null | undefined;
  now: number;
  confirmed: boolean;
}): SendOverClaim {
  const { liveness, run } = input;
  if (!claimIsLive(liveness)) return { send: true };

  if (liveness === 'quiet' && run) {
    if (input.confirmed) return { send: true };
    return { send: false, ask: quietSendAsk(input.number, run, input.now), confirmable: true };
  }

  return {
    send: false,
    ask: `#${input.number} is already underway. Put it back to not started first if the session that had it is gone.`,
    confirmable: false,
  };
}

/* -------------------------------------------------------------------------
 * Another step under the same feature
 * ---------------------------------------------------------------------- */

/**
 * Which press was refused, since the two say where the claim is differently.
 *
 * `step` is a press on one step, refused because a different step under its
 * feature is held. `feature` is a press on the whole feature, refused because
 * something under it -- or the feature row itself -- is held, so there is no
 * "other" to point at.
 */
export type UnderwayPress = 'step' | 'feature';

/**
 * Why a feature with a session in it will not take another one. #587.
 *
 * One session per feature at a time, and #587 settled that a quiet run holds
 * its feature shut exactly as a working one does: the twenty-minute mark is
 * known to read wrong on a session that is reading files, and spending that
 * reading on the one collision the rule exists to prevent puts two sessions in
 * the same files on different work. Re-sending the quiet step *itself* is the
 * other half, #574, and it is `sendOverClaim` above -- so this is never a
 * question, only a refusal.
 *
 * What it adds over the sentence the guard gave before is the evidence: a run
 * that has pushed nothing for half an hour is the case where you want to know
 * that before deciding whether to put its step back, and "is underway" on its
 * own hides it behind opening the row. A claim with nothing read about it says
 * nothing extra, which is the same as it read before.
 *
 * Both guards in `handover.ts` word it through here for the reason
 * `sendOverClaim` is shared: two copies of a refusal drift, and the one that
 * drifts is the one nobody presses.
 */
export function underwayRefusal(input: {
  press: UnderwayPress;
  /** The step holding the feature. */
  number: number;
  title: string;
  /** What its claim reads as, from `claimLiveness`. */
  liveness: ClaimLiveness | null;
  run: QuietRun | null | undefined;
  now: number;
}): string {
  const where =
    input.press === 'step' ? 'is underway under the same feature' : 'is already underway';
  const silence =
    input.liveness === 'quiet' && input.run ? ` ${quietRunNote(input.run, input.now)}` : '';
  return (
    `#${input.number} ${input.title} ${where}.${silence} ` +
    'Wait for it, or put it back to not started if its session is gone.'
  );
}

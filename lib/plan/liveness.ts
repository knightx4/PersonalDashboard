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
import { elapsedSince } from './elapsed';
import { RUN_QUIET_AFTER_MINUTES } from './run-end';

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

/**
 * A push, and what the commit it left on the branch says it was.
 *
 * Here rather than beside the request that fills it in, for the reason the
 * whole of this file is here: `ci.ts` is server-only and the plan page draws
 * the answer in the browser, so the shape it draws has to live on the
 * browser-safe side of the pair.
 */
export type PushedCommit = Push & {
  /** The commit's subject line, or null when GitHub would not say. */
  subject: string | null;
};

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

/** How long a run has been silent, in minutes, counting from when it started. */
function silentMinutes(evidence: RunEvidence, now: number): number {
  const fired = new Date(evidence.startedAt).getTime();
  const pushed = evidence.lastPush ? new Date(evidence.lastPush.at).getTime() : 0;
  return (now - Math.max(fired, pushed)) / 60_000;
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

  const silent = silentMinutes(evidence, now);
  if (silent >= ENDED_AFTER_MINUTES) return 'ended';
  if (silent >= QUIET_AFTER_MINUTES) return 'quiet';
  return 'working';
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

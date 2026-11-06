/**
 * What is running now, for the Now section at the top of a project's page and
 * Dev's plan (plan #2800.3).
 *
 * Two sources, one list. A session that reports (plan #2800.1) speaks for
 * itself through its row in core.session_progress: what it is doing, and what
 * it needs while it waits on you. A run that has not reported is still
 * listed, read the way the plan has always read a claim, off its pushes and
 * the clock, so the section never loses a session the plan knows is going.
 * Once a run's session reports on it, its report replaces the guess.
 *
 * Client-safe and free of the database: lib/plan/now-load.ts reads the rows,
 * and the page and the gallery both hand them here.
 */

import type { ProgressState } from './session-progress';
import type { ClaimLiveness } from './liveness';

/** No report for this long and a session is marked stale: it may have ended without saying so. */
export const STALE_AFTER_MS = 20 * 60_000;

/**
 * A report older than this is no longer listed as running. A session that
 * crashed never reports `done`, and its last line would otherwise sit at the
 * top of the page for good. Two hours is when the plan counts a silent claim
 * as gone (lib/plan/liveness.ts).
 */
export const GONE_AFTER_MS = 2 * 60 * 60_000;

/** How many sessions the section lists; more than this is a sign something is not reporting its end. */
export const NOW_LIMIT = 12;

/** A core.session_progress row, as now-load.ts reads it. */
export type ProgressRow = {
  sessionId: string;
  planItemId: string | null;
  planRunId: string | null;
  threadId: string | null;
  project: string | null;
  state: ProgressState;
  action: string;
  needs: string | null;
  startedAt: string;
  updatedAt: string;
};

/** Enough of a plan row to name it and say which section it is in. */
export type NowStep = {
  id: string;
  /** `#2800.3`, as the page heads the row. */
  ref: string;
  title: string;
  /** The step's own page. */
  href: string;
  /** Its workspace or project id, for a project page's filter. */
  module: string | null;
};

/** A run going now that the plan knows about, with what the plan guesses of it. */
export type GoingRun = {
  runId: string | null;
  planItemId: string;
  startedAt: string;
  /** started, awaiting_input or stale. */
  status: string;
  /** The push-based reading of its claim, when there is one. */
  liveness: ClaimLiveness | null;
  /** Its newest push, if it has made one. */
  lastPush: { at: string; subject: string | null } | null;
  /** When it last wrote a run line (plan #1825). */
  lastLineAt: string | null;
};

/** A question a run asked and is waiting on, from lib/plan/run-answer.ts. */
export type NowQuestion = { runId: string; body: string | null; options: string[] | null };

export type NowSession = {
  key: string;
  /** `report` when the session said it; `guess` when it is read off pushes. */
  source: 'report' | 'guess';
  state: 'working' | 'waiting';
  /** The latest thing it did, in one line. */
  action: string;
  /** What it needs from you; only while waiting. */
  needs: string | null;
  /** When it last said anything, or the newest sign of life for a guess. */
  at: string;
  step: NowStep | null;
  /** The Dev project it works on, when it said. */
  project: string | null;
  /** The question its run is waiting on, answered here with its choices. */
  question: NowQuestion | null;
  /** The run it was sent as, for answering when there is no question line. */
  runId: string | null;
};

/** The last session to finish, for the section's empty state. */
export type NowFinished = {
  state: 'done' | 'stopped';
  action: string;
  at: string;
  step: NowStep | null;
};

export type NowList = { sessions: NowSession[]; finished: NowFinished | null };

function ms(at: string | null | undefined): number {
  const value = at ? Date.parse(at) : Number.NaN;
  return Number.isNaN(value) ? 0 : value;
}

function latest(...times: (string | null | undefined)[]): string {
  let best: string | null = null;
  for (const time of times) if (time && ms(time) > ms(best)) best = time;
  return best ?? new Date(0).toISOString();
}

/** Whether a row belongs on this page: everything on Dev's plan, a project's own on its page. */
function inScope(scope: string | null, project: string | null, step: NowStep | null): boolean {
  if (scope === null) return true;
  return project === scope || step?.module === scope;
}

/** The line a run that has not reported shows, from what the plan can see of it. */
function guessedAction(run: GoingRun): string {
  if (run.lastPush) {
    return run.lastPush.subject ? `Pushed: ${run.lastPush.subject}` : 'Pushed a commit';
  }
  if (run.liveness === 'quiet' || run.status === 'stale') return 'Started, and has not pushed or written since';
  return 'Started; nothing pushed yet';
}

/**
 * Whether the section marks a session stale: twenty minutes with nothing
 * said. A guessed session waiting on your answer is not stale, since it is
 * you it is waiting on.
 */
export function isStale(session: Pick<NowSession, 'at' | 'state'>, now: number): boolean {
  if (now === 0) return false;
  if (session.state === 'waiting') return false;
  return now - ms(session.at) >= STALE_AFTER_MS;
}

/**
 * The line without the step's title when it only repeats it, as a commit
 * subject usually does: "Committed 4e1a9c2: Add the RSS feed" under the step
 * "Add the RSS feed" reads "Committed 4e1a9c2".
 */
export function withoutTitle(action: string, title: string | undefined): string {
  if (!title) return action;
  const tail = `: ${title}`;
  const at = action.toLowerCase().lastIndexOf(tail.toLowerCase());
  if (at > 0 && at + tail.length === action.length) return action.slice(0, at);
  return action;
}

/**
 * The sessions going now, newest report first with anything waiting on you
 * ahead of the rest, and the last one to finish for when nothing is.
 *
 * `scope` is the project whose page this is, or null for Dev's plan.
 */
export function nowSessions(input: {
  progress: readonly ProgressRow[];
  going: readonly GoingRun[];
  steps: ReadonlyMap<string, NowStep>;
  questions: readonly NowQuestion[];
  /** Run ids known to have ended, so a report on one that never said done is not listed. */
  endedRuns: ReadonlySet<string>;
  scope: string | null;
  now: number;
}): NowList {
  const questionOf = new Map(input.questions.map((question) => [question.runId, question]));
  const sessions: NowSession[] = [];
  let finished: NowFinished | null = null;
  // The runs and steps a report already speaks for, so their guess is dropped.
  const reportedRuns = new Set<string>();
  const reportedSteps = new Set<string>();

  const rows = [...input.progress].sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt));
  for (const row of rows) {
    const step = row.planItemId ? (input.steps.get(row.planItemId) ?? null) : null;
    if (!inScope(input.scope, row.project, step)) continue;
    if (row.planRunId) reportedRuns.add(row.planRunId);
    if (row.planItemId) reportedSteps.add(row.planItemId);

    if (row.state === 'done' || row.state === 'stopped') {
      finished ??= { state: row.state, action: row.action, at: row.updatedAt, step };
      continue;
    }
    if (input.now - ms(row.updatedAt) >= GONE_AFTER_MS) continue;
    if (row.planRunId && input.endedRuns.has(row.planRunId)) continue;

    sessions.push({
      key: `report:${row.sessionId}:${row.planItemId ?? ''}`,
      source: 'report',
      state: row.state,
      action: row.action,
      needs: row.state === 'waiting' ? row.needs : null,
      at: row.updatedAt,
      step,
      project: row.project,
      question: row.planRunId ? (questionOf.get(row.planRunId) ?? null) : null,
      runId: row.planRunId,
    });
  }

  for (const run of input.going) {
    if (run.runId && reportedRuns.has(run.runId)) continue;
    if (reportedSteps.has(run.planItemId)) continue;
    const step = input.steps.get(run.planItemId) ?? null;
    if (!inScope(input.scope, null, step)) continue;
    const question = run.runId ? (questionOf.get(run.runId) ?? null) : null;
    const waiting = run.status === 'awaiting_input';
    sessions.push({
      key: `guess:${run.runId ?? run.planItemId}`,
      source: 'guess',
      state: waiting ? 'waiting' : 'working',
      action: waiting ? 'Asked you a question' : guessedAction(run),
      needs: waiting ? (question?.body ?? 'Its question is on the step.') : null,
      at: latest(run.startedAt, run.lastPush?.at, run.lastLineAt),
      step,
      project: null,
      question,
      runId: run.runId,
    });
  }

  sessions.sort((a, b) => {
    if (a.state !== b.state) return a.state === 'waiting' ? -1 : 1;
    return ms(b.at) - ms(a.at);
  });
  return { sessions: sessions.slice(0, NOW_LIMIT), finished };
}

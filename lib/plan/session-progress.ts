/**
 * A session's report of what it is doing (plan #2800.1): the row in
 * core.session_progress it rewrites as it works, through
 * core.report_session_progress (migration 0289).
 *
 * Two callers send the same report: the Dash connector's report_progress
 * tool (lib/connector/writes.ts), for a session in any repository, and
 * `scripts/plan.ts progress`, for a builder in this one. Both read their
 * input here, so the two refuse the same things in the same words. The
 * database checks again, and checks every id against the account.
 *
 * Client-safe and free of the database: the callers make the call.
 */

export const PROGRESS_STATES = ['working', 'waiting', 'done', 'stopped'] as const;
export type ProgressState = (typeof PROGRESS_STATES)[number];

/** The longest action line the table keeps; a longer one is cut with an ellipsis. */
export const ACTION_MAX = 300;
/** The longest "needs" the table keeps; a longer one is refused, since cutting a question changes it. */
export const NEEDS_MAX = 2000;

export type ProgressReport = {
  sessionId: string;
  state: ProgressState;
  action: string;
  needs: string | null;
  planRunId: string | null;
  planItemId: string | null;
  threadId: string | null;
  project: string | null;
};

export type ProgressInput = {
  session_id?: unknown;
  state?: unknown;
  action?: unknown;
  needs?: unknown;
  run_id?: unknown;
  plan_item_id?: unknown;
  thread_id?: unknown;
  project?: unknown;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION = /^[A-Za-z0-9_-]{1,200}$/;
const PROJECT = /^[a-z][a-z0-9-]{0,39}$/;

function text(value: unknown, key: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new ProgressInputError(`${key} must be text.`);
  return value.replace(/\s+/g, ' ').trim() || null;
}

function uuid(value: unknown, key: string, what: string): string | null {
  const raw = text(value, key);
  if (raw === null) return null;
  if (!UUID.test(raw)) throw new ProgressInputError(`${key} must be ${what}'s id.`);
  return raw.toLowerCase();
}

export class ProgressInputError extends Error {}

/**
 * Read a report, or throw ProgressInputError saying what to fix. A "needs"
 * sent with any state but waiting is dropped, since the row only says what a
 * session needs while it waits.
 */
export function readProgress(input: ProgressInput): ProgressReport {
  const sessionId = text(input.session_id, 'session_id');
  if (!sessionId) throw new ProgressInputError('session_id is required: the id of the session reporting (cse_…).');
  if (!SESSION.test(sessionId)) throw new ProgressInputError('session_id must be a session id, such as cse_015….');

  const state = text(input.state, 'state');
  if (!state || !(PROGRESS_STATES as readonly string[]).includes(state)) {
    throw new ProgressInputError(`state must be one of ${PROGRESS_STATES.join(', ')}.`);
  }

  const action = text(input.action, 'action');
  if (!action) throw new ProgressInputError('action is required: what the session did last, in one line.');

  const needs = state === 'waiting' ? text(input.needs, 'needs') : null;
  if (state === 'waiting' && !needs) {
    throw new ProgressInputError('needs is required while waiting: what the session needs from the person.');
  }
  if (needs && needs.length > NEEDS_MAX) throw new ProgressInputError(`needs is longer than ${NEEDS_MAX} characters.`);

  const project = text(input.project, 'project');
  if (project && !PROJECT.test(project)) throw new ProgressInputError('project must be a Dev project\'s id, such as music-pipeline.');

  return {
    sessionId,
    state: state as ProgressState,
    action: action.length > ACTION_MAX ? `${action.slice(0, ACTION_MAX - 1)}…` : action,
    needs,
    planRunId: uuid(input.run_id, 'run_id', 'a plan run'),
    planItemId: uuid(input.plan_item_id, 'plan_item_id', 'a plan step'),
    threadId: uuid(input.thread_id, 'thread_id', 'a session thread'),
    project,
  };
}

/** The arguments of core.report_session_progress for one report. */
export function progressRpcArgs(userId: string, report: ProgressReport) {
  return {
    p_user_id: userId,
    p_session_id: report.sessionId,
    p_state: report.state,
    p_action: report.action,
    p_needs: report.needs,
    p_plan_run_id: report.planRunId,
    p_plan_item_id: report.planItemId,
    p_thread_id: report.threadId,
    p_project: report.project,
  };
}

/** The session this process runs in, as a cloud session names itself; null when it cannot tell. */
export function currentSessionId(env: Record<string, string | undefined>): string | null {
  const id = env.CLAUDE_CODE_REMOTE_SESSION_ID ?? env.CLAUDE_CODE_SESSION_ID ?? null;
  return id && SESSION.test(id) ? id : null;
}

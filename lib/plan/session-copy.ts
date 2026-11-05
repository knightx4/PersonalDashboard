/**
 * Copying a session's own summary into its progress row (plan #2800.2).
 *
 * A session that never calls report_progress still shows a current line: on
 * each wake the projects dispatcher and the broker call get_session for every
 * open session they started and hand what it says to `npm run session-sync --
 * copy`. This file decides what that writes. Client-safe and free of the
 * database; lib/plan/session-copy-store.ts makes the calls.
 *
 * A session that reported something newer itself keeps its report: the copy
 * only touches the row's time, so the row says the session was seen open at
 * this wake without replacing what the session said.
 */
import { ACTION_MAX, type ProgressState } from './session-progress';

/** What get_session reports a session as. */
export const SESSION_STATUSES = ['running', 'idle', 'ended', 'archived'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export type OpenSession = {
  sessionId: string;
  /** Where the broker or dispatcher started it from. */
  origin: 'thread' | 'run';
  planRunId: string | null;
  planItemId: string | null;
  threadId: string | null;
  project: string | null;
};

export type CopyDecision =
  | { kind: 'write'; state: ProgressState; action: string }
  | { kind: 'touch' };

/** Collapse a summary to one line, cut at the length the table keeps. */
export function summaryLine(summary: string | null | undefined, fallback: string): string {
  const line = (summary ?? '').replace(/\s+/g, ' ').trim() || fallback;
  return line.length > ACTION_MAX ? `${line.slice(0, ACTION_MAX - 1)}…` : line;
}

/**
 * The progress state a session's status stands for. A thread's session that
 * is idle has answered and waits for the next message: done. A run's worker
 * that is idle has not yet reported to the dispatcher, so it still counts as
 * working until the dispatcher closes the run.
 */
export function stateFor(status: SessionStatus, origin: OpenSession['origin']): ProgressState {
  if (status === 'ended' || status === 'archived') return 'stopped';
  if (status === 'idle' && origin === 'thread') return 'done';
  return 'working';
}

/**
 * What to do for one session: write the session's summary, or, when the row
 * was reported after the session's last activity, only touch it.
 */
export function decideCopy(input: {
  origin: OpenSession['origin'];
  status: SessionStatus;
  summary: string | null | undefined;
  /** When the session last did anything, from get_session. Null when unknown. */
  activityAt: string | null;
  /** The existing row's updated_at, or null when there is no row. */
  rowUpdatedAt: string | null;
}): CopyDecision {
  const row = input.rowUpdatedAt ? Date.parse(input.rowUpdatedAt) : NaN;
  const activity = input.activityAt ? Date.parse(input.activityAt) : NaN;
  if (Number.isFinite(row) && Number.isFinite(activity) && row > activity) return { kind: 'touch' };
  const state = stateFor(input.status, input.origin);
  const fallback =
    state === 'stopped' ? 'The session has ended.' : state === 'done' ? 'The session is idle.' : 'The session is running.';
  return { kind: 'write', state, action: summaryLine(input.summary, fallback) };
}

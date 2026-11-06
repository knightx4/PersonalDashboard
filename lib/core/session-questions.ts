/**
 * A question a session reported it is waiting on (plan #2800.4), as the Goals
 * Inbox lists it and as the answer is sent back.
 *
 * The row is a `waiting` report in core.session_progress. It reaches the
 * session by whichever way back that session has:
 *
 *   thread    the session answers in a session thread (#2789): the answer is
 *             written on the thread's open question message, or as the
 *             person's message when it asked in words, and the session reads
 *             it with read_thread.
 *   plan_run  the session was sent as a plan run: the answer is a response
 *             line on the run, which `plan.ts response` reads back, and a
 *             run parked on a question is woken or continued as for any
 *             run question (lib/plan/run-answer.ts).
 *   none      the report names neither. It is listed so the wait is seen,
 *             but nothing here can reach it.
 *
 * An answer is not written onto the progress row, which the person may only
 * read. The row stops being listed because something newer than the report
 * answers it (`answeredSince`), and goes for good when the session reports
 * again. Pure; the reads and writes are in session-questions-store.ts.
 */

export type SessionRoute = 'thread' | 'plan_run' | 'none';

/** A wait older than this is a session that left, and is not listed. */
export const LISTED_DAYS = 3;

export type SessionQuestion = {
  /** The progress row's id, which the answer names. */
  id: string;
  /** What the session is on: a step's outline and title, a project, or a thread's title. */
  about: string;
  /** Where the work is, for the row's link. */
  href: string;
  /** The question, or the job, in the session's words. */
  body: string;
  /** A question's choices, from its open question message or run line; null when asked in words. */
  options: string[] | null;
  askedAt: string;
  route: SessionRoute;
};

/** The way back for a report: a thread first, since it carries options, then a run. */
export function routeOf(row: { threadId: string | null; planRunId: string | null }): SessionRoute {
  if (row.threadId) return 'thread';
  if (row.planRunId) return 'plan_run';
  return 'none';
}

/**
 * Whether anything the person wrote came after the report: an answer, or a
 * message in the thread. Times are ISO strings, compared as instants.
 */
export function answeredSince(reportedAt: string, personWroteAt: readonly (string | null)[]): boolean {
  const reported = Date.parse(reportedAt);
  return personWroteAt.some((at) => at !== null && Date.parse(at) > reported);
}

/** The choices of a question message, or null when it has none readable. */
export function optionsOf(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const options = raw.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
  return options.length > 0 ? options : null;
}

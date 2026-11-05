/**
 * A session thread kept current over Realtime (plan #2789.12): what the
 * screen holds besides what the server read, and how the two are merged.
 * Pure, so the tests and the gallery read it as the page does; the
 * subscription itself is components/thread/use-session-thread-live.ts.
 *
 * Three tables feed an open thread. core.session_messages brings each reply,
 * question, mockup and status line as it is written, and an answer when a
 * question row is updated. core.session_threads brings the thread's state
 * (queued to working when the broker delivers, working to waiting on a
 * question, working to idle when the broker finds the session stopped).
 * core.session_progress holds one row per session and step that the session
 * rewrites as it reports (report_progress), so each version of that row heard
 * while the page is open is kept as its own line.
 */
import type { RunActivity } from './run-activities';
import { stateOf, threadTurns, type SessionMessage, type SessionThread, type SessionThreadState } from './session-threads-model';

/** One report from the session's progress row, as it read at one moment. */
export type SessionProgressReport = {
  /** The row's id and the time it was written, so a rewrite is a new report. */
  key: string;
  state: 'working' | 'waiting' | 'done' | 'stopped';
  action: string;
  needs: string | null;
  at: string;
};

const PROGRESS_STATES = ['working', 'waiting', 'done', 'stopped'] as const;

/** The columns a progress report is read with. */
export const PROGRESS_COLUMNS = 'id, state, action, needs, updated_at';

/** A core.session_progress row as one report; null for a row that is not one. */
export function progressReportOf(row: Record<string, unknown> | null | undefined): SessionProgressReport | null {
  if (!row) return null;
  const id = typeof row.id === 'string' ? row.id : null;
  const at = typeof row.updated_at === 'string' ? row.updated_at : null;
  const action = typeof row.action === 'string' ? row.action.trim() : '';
  const state = PROGRESS_STATES.find((s) => s === row.state) ?? null;
  if (!id || !at || !action || !state) return null;
  return { key: `${id}@${at}`, state, action, needs: typeof row.needs === 'string' ? row.needs : null, at };
}

function time(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** The reports held with the ones just heard, oldest first, none twice. */
export function mergeReports(
  held: readonly SessionProgressReport[],
  incoming: readonly SessionProgressReport[],
): SessionProgressReport[] {
  const byKey = new Map<string, SessionProgressReport>();
  for (const r of [...held, ...incoming]) byKey.set(r.key, r);
  return [...byKey.values()].sort((a, b) => time(a.at) - time(b.at) || a.key.localeCompare(b.key));
}

/**
 * The messages the server read merged with those heard since, oldest first,
 * each once. The server's copy stands unless the heard one carries an answer
 * the server's does not yet, since an answer is the one change a row takes.
 */
export function mergeThreadMessages(
  server: readonly SessionMessage[],
  heard: readonly SessionMessage[],
): SessionMessage[] {
  const byId = new Map<string, SessionMessage>();
  for (const m of server) byId.set(m.id, m);
  for (const m of heard) {
    const held = byId.get(m.id);
    if (!held || (m.answer !== null && held.answer === null)) {
      // A row heard over Realtime has no recorded file name; keep the server's.
      byId.set(m.id, held?.attachment ? { ...m, attachment: held.attachment } : m);
    }
  }
  return [...byId.values()].sort((a, b) => time(a.createdAt) - time(b.createdAt) || a.id.localeCompare(b.id));
}

/** Where the thread stands, as a core.session_threads row says it. */
export type HeardThread = { state: SessionThreadState; sessionId: string | null; updatedAt: string };

export function heardThreadOf(row: Record<string, unknown> | null | undefined): HeardThread | null {
  if (!row || typeof row.updated_at !== 'string') return null;
  return {
    state: stateOf(row.state),
    sessionId: typeof row.session_id === 'string' ? row.session_id : null,
    updatedAt: row.updated_at,
  };
}

/** The thread with what was heard of its row since, when that is newer than what the server read. */
export function threadWithHeard<T extends SessionThread | null>(thread: T, heard: HeardThread | null): T {
  if (!thread || !heard) return thread;
  if (thread.updatedAt && time(heard.updatedAt) < time(thread.updatedAt)) return thread;
  return { ...thread, state: heard.state, sessionId: heard.sessionId ?? thread.sessionId };
}

/**
 * The session's lines since your last message, oldest first: its status
 * messages and each progress report, drawn as a run's lines are. A line
 * that says the same as the one before it is left out, since a session often
 * reports and writes a status line in the same words.
 */
export function sessionLines(
  threadId: string,
  messages: readonly SessionMessage[],
  reports: readonly SessionProgressReport[],
): RunActivity[] {
  const lastYours = threadTurns(messages).filter((m) => m.author === 'person').at(-1);
  const since = lastYours ? time(lastYours.createdAt) : 0;
  const line = (id: string, body: string, at: string): RunActivity => ({
    id,
    user_id: '',
    run_table: 'plan_runs',
    run_id: threadId,
    kind: 'action',
    body,
    options: null,
    created_at: at,
  });
  const all = [
    ...messages
      .filter((m) => m.kind === 'status' && m.author === 'session' && m.body.trim() && time(m.createdAt) >= since)
      .map((m) => line(m.id, m.body.trim(), m.createdAt)),
    ...reports.filter((r) => time(r.at) >= since).map((r) => line(`progress:${r.key}`, r.action, r.at)),
  ].sort((a, b) => time(a.created_at) - time(b.created_at) || a.id.localeCompare(b.id));
  return all.filter((l, i) => i === 0 || l.body !== all[i - 1].body);
}

/** The newest thing the session said it is doing, or null when it has said nothing since your last message. */
export function latestSessionLine(
  messages: readonly SessionMessage[],
  reports: readonly SessionProgressReport[],
): string | null {
  return sessionLines('', messages, reports).at(-1)?.body ?? null;
}

/**
 * The thread list with what was heard since it was read: each thread's state
 * and when it last moved, newest first, and `moved` set on a thread that
 * moved while the list was open and is not the one open now.
 */
export function listWithHeard(
  threads: readonly SessionThread[],
  heard: ReadonlyMap<string, { state?: SessionThreadState; at: string }>,
  open: string | null,
  /** When each thread was last open, as the time of the newest thing heard on it then. */
  seen: ReadonlyMap<string, string> = new Map(),
): SessionThread[] {
  return threads
    .map((t) => {
      const h = heard.get(t.id);
      if (!h) return t;
      const newer = time(h.at) > time(t.lastAt);
      const looked = seen.get(t.id);
      const moved = newer && t.id !== open && (!looked || time(h.at) > time(looked));
      return { ...t, state: h.state ?? t.state, lastAt: newer ? h.at : t.lastAt, moved };
    })
    .sort((a, b) => time(b.lastAt) - time(a.lastAt));
}

/**
 * A thread with a Claude Code session as Chat draws it (plan #2789.7, feature
 * #2789): the rows of core.session_threads and core.session_messages
 * (migration 0289) turned into what the Dash tab lists and the thread screen
 * shows. Pure, so the gallery and the tests read it as the page does.
 *
 * A status message is the session saying what it is doing. It is not a turn:
 * the newest one since your last message is the working line under the
 * turns, drawn only while a reply is still to come.
 */

export const SESSION_THREAD_STATES = ['queued', 'working', 'waiting', 'idle', 'ended'] as const;
export type SessionThreadState = (typeof SESSION_THREAD_STATES)[number];

export type SessionMessageKind = 'text' | 'mockup' | 'question' | 'status';

/** A file the person sent with a message, opened through /attachments. */
export type SessionAttachment = { name: string; href: string | null };

export type SessionMessage = {
  id: string;
  author: 'person' | 'session';
  kind: SessionMessageKind;
  body: string;
  options: string[] | null;
  artifactUrl: string | null;
  attachment: SessionAttachment | null;
  answer: string | null;
  answeredAt: string | null;
  createdAt: string;
};

/** One thread as the list and the screen name it. */
export type SessionThread = {
  id: string;
  title: string;
  /** The dev_projects id, or null for this app. */
  projectId: string | null;
  /** The project's name, or "This app". */
  projectLabel: string;
  sessionId: string | null;
  state: SessionThreadState;
  /** When anything last happened in it, for the list's order and its time. */
  lastAt: string;
};

/** The name a thread on this app carries where a project's would go. */
export const THIS_APP_LABEL = 'This app';

/** Longest message, as core.session_messages allows. */
export const SESSION_MESSAGE_MAX = 40_000;
/** Longest answer to a question, as the table allows. */
export const SESSION_ANSWER_MAX = 2_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isThreadId(value: string): boolean {
  return UUID.test(value);
}

/** Where a thread opens: the Dash tab of Chat. */
export function sessionThreadPath(threadId: string): string {
  return `/chat/dash/session/${encodeURIComponent(threadId)}`;
}

/** Where a new thread starts, aimed at a project when one is named. */
export function newSessionThreadHref(projectId?: string | null): string {
  const base = '/chat/dash/session/new';
  return projectId ? `${base}?project=${encodeURIComponent(projectId)}` : base;
}

/** The thread id at this address, "new" on a new thread, or null when none is open. */
export function openSessionRef(pathname: string): string | null {
  const match = pathname.match(/^\/chat\/dash\/session\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/** The session's own page in Claude, once the thread holds a session id. */
export function claudeSessionUrl(sessionId: string | null): string | null {
  if (!sessionId || !/^[A-Za-z0-9_-]{1,200}$/.test(sessionId)) return null;
  return `https://claude.ai/code/${sessionId}`;
}

/** One line on where the thread stands, as its card and its row say it. */
export function stateLabel(state: SessionThreadState): string {
  switch (state) {
    case 'queued':
      return 'Waiting for a session to start';
    case 'working':
      return 'Working';
    case 'waiting':
      return 'Waiting on you';
    case 'idle':
      return 'Stopped. A message wakes it';
    case 'ended':
      return 'Ended';
  }
}

/** The short word the list gives a thread's state, or null when there is nothing to say. */
export function stateWord(state: SessionThreadState): string | null {
  if (state === 'waiting') return 'Waiting on you';
  if (state === 'working') return 'Working';
  if (state === 'queued') return 'Starting';
  return null;
}

/** A thread's title from what it was started with: the first line, cut short. */
export function threadTitleFrom(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const flat = line.replace(/\s+/g, ' ');
  if (!flat) return 'A conversation with a session';
  return flat.length > 80 ? `${flat.slice(0, 79).trimEnd()}…` : flat;
}

/** The turns drawn in the thread, oldest first: every message but the status lines. */
export function threadTurns(messages: readonly SessionMessage[]): SessionMessage[] {
  return messages.filter((m) => m.kind !== 'status');
}

/** Your message the session has not answered yet, if the last turn is yours. */
export function awaitingReply(messages: readonly SessionMessage[]): boolean {
  const last = threadTurns(messages).at(-1);
  return last?.author === 'person';
}

/**
 * The line under the turns while a reply is to come: what the session last
 * reported since your message, or where the thread stands when it has said
 * nothing yet. Null when no reply is pending, or the thread has ended.
 */
export function workingLine(
  state: SessionThreadState,
  messages: readonly SessionMessage[],
  reported: string | null = null,
): string | null {
  if (state === 'ended' || state === 'waiting') return null;
  if (!awaitingReply(messages) && state !== 'working') return null;
  const lastTurn = threadTurns(messages).at(-1);
  const since = lastTurn ? Date.parse(lastTurn.createdAt) : 0;
  const status = [...messages]
    .reverse()
    .find((m) => m.kind === 'status' && m.author === 'session' && Date.parse(m.createdAt) >= since && m.body.trim());
  if (status) return status.body.trim();
  if (reported?.trim()) return reported.trim();
  if (state === 'queued') return 'Waiting for a session to pick this up';
  if (state === 'idle') return 'Waiting for the session to wake';
  return 'Working on it';
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function optionsOf(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const list = value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim());
  return list.length > 0 ? list : null;
}

/** The file's name from its path in the bucket, `<user>/<uuid>-<name>`, when no recorded name is to hand. */
export function attachmentName(path: string): string {
  const last = path.split('/').at(-1) ?? path;
  return last.replace(/^[0-9a-f-]{36}-/, '') || 'A file';
}

/**
 * A core.session_messages row as the screen reads it; null for a row that is
 * not one. `file` is the attachment's recorded name and link, when the row's
 * file was recorded in core.attachments.
 */
export function sessionMessageOf(row: Record<string, unknown>, file: SessionAttachment | null = null): SessionMessage | null {
  const id = text(row.id);
  const createdAt = text(row.created_at);
  const author = row.author === 'person' || row.author === 'session' ? row.author : null;
  const kind = (['text', 'mockup', 'question', 'status'] as const).find((k) => k === row.kind) ?? null;
  if (!id || !createdAt || !author || !kind) return null;
  const path = text(row.attachment_path);
  return {
    id,
    author,
    kind,
    body: text(row.body) ?? '',
    options: kind === 'question' ? optionsOf(row.options) : null,
    artifactUrl: text(row.artifact_url),
    attachment: path ? (file ?? { name: attachmentName(path), href: null }) : null,
    answer: text(row.answer),
    answeredAt: text(row.answered_at),
    createdAt,
  };
}

export function stateOf(value: unknown): SessionThreadState {
  return (SESSION_THREAD_STATES as readonly unknown[]).includes(value) ? (value as SessionThreadState) : 'queued';
}

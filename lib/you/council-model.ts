/**
 * The Council's rules and shapes (you 0037), apart from the reads and writes
 * in lib/you/council.ts so the Council's client screens can import them: the
 * caps on notes, the reply timeout, and the readers that keep a row a
 * session wrote from breaking the page.
 */
export const COUNCIL_SKILL_PATH = '.claude/skills/board/council.md';

/** The caps the person asked for; you.council_notes_cap holds the same numbers. */
export const UNREAD_MAX = 6;
export const NOTES_PER_DAY = 3;

export const MESSAGE_MAX = 4000;
export const REACTION_NOTE_MAX = 1000;

/** A round still open this long after it was asked for has stopped. */
export const ADVICE_STALE_AFTER_MS = 3 * 60 * 60 * 1000;
/** A reply still being written this long after the message was sent has stopped. */
export const REPLY_STALE_AFTER_MS = 90 * 60 * 1000;
/** The daily round is not started again within this long of the last one. */
export const ADVICE_GAP_MS = 20 * 60 * 60 * 1000;
/** A conversation in a mentor thread is over after this long without a message (you 0038). */
export const EPISODE_QUIET_MS = 3 * 60 * 60 * 1000;

/**
 * Whether the overnight memory pass should summarise an episode (plan
 * #2748.8): it is over, and it has no summary or grew after its summary.
 */
export function episodeDue(episode: { endedAt: string; summarisedAt: string | null }, now: number): boolean {
  const ended = Date.parse(episode.endedAt);
  if (!Number.isFinite(ended) || now - ended < EPISODE_QUIET_MS) return false;
  if (!episode.summarisedAt) return true;
  const summarised = Date.parse(episode.summarisedAt);
  return !Number.isFinite(summarised) || summarised < ended;
}

export const STALE_REPLY_ERROR = 'The reply stopped before it was written. Send again to ask once more.';
export const NO_ROUTINE_ERROR =
  'Mentors reply on the board routine, which is not set up on this deployment: it needs CLAUDE_BOARD_ROUTINE_ID and CLAUDE_BOARD_ROUTINE_TOKEN.';

export type CouncilReceipt = { label: string; link: string };

export const REACTIONS = ['useful', 'not_useful', 'disagree'] as const;
export type Reaction = (typeof REACTIONS)[number];

export type CouncilNote = {
  id: string;
  advisorId: string;
  text: string;
  receipts: CouncilReceipt[];
  createdAt: string;
  readAt: string | null;
  reaction: Reaction | null;
  reactionNote: string | null;
  taskId: string | null;
};

export type ReplyStatus = 'idle' | 'waiting' | 'failed';

export type CouncilChat = {
  id: string;
  replyStatus: ReplyStatus;
  replyRequestedAt: string | null;
  replyError: string | null;
};

export type CouncilMessage = {
  id: string;
  role: 'person' | 'advisor';
  text: string;
  receipts: CouncilReceipt[];
  createdAt: string;
  noteId: string | null;
};

export const MEMORY_KINDS = ['fact', 'preference', 'commitment', 'open_thread'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export type CouncilMemory = {
  id: string;
  kind: MemoryKind;
  text: string;
  dueOn: string | null;
  doneAt: string | null;
  createdAt: string;
};

/** One mentor as the Council's grid draws them. */
export type Mentor = {
  id: string;
  key: string;
  name: string;
  kind: 'seat' | 'guest';
  question: string;
  focus: string | null;
  active: boolean;
  /** A seat always can; a guest only once its brain is built. */
  canTalk: boolean;
  /** Their newest note, read or not. */
  note: CouncilNote | null;
  /** Their reply is being written. */
  waiting: boolean;
};

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const strOrNull = (value: unknown): string | null => str(value) || null;

/** Receipts as the session wrote them; one without a label or a link is dropped. */
export function receiptsOf(value: unknown): CouncilReceipt[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    const label = str(row.label);
    const link = str(row.link);
    if (!label || !link) return [];
    if (!link.startsWith('/') && !link.startsWith('https://')) return [];
    return [{ label, link }];
  });
}

export const NOTE_COLUMNS =
  'id, advisor_id, text, receipts, created_at, read_at, reaction, reaction_note, task_id';

export function noteOf(row: Record<string, unknown>): CouncilNote | null {
  const text = str(row.text);
  if (typeof row.id !== 'string' || typeof row.advisor_id !== 'string' || !text) return null;
  const reaction = REACTIONS.find((r) => r === row.reaction) ?? null;
  return {
    id: row.id,
    advisorId: row.advisor_id,
    text,
    receipts: receiptsOf(row.receipts),
    createdAt: str(row.created_at),
    readAt: strOrNull(row.read_at),
    reaction,
    reactionNote: strOrNull(row.reaction_note),
    taskId: strOrNull(row.task_id),
  };
}

export function chatOf(row: Record<string, unknown>): CouncilChat | null {
  if (typeof row.id !== 'string') return null;
  const status = row.reply_status === 'waiting' || row.reply_status === 'failed' ? row.reply_status : 'idle';
  return {
    id: row.id,
    replyStatus: status,
    replyRequestedAt: strOrNull(row.reply_requested_at),
    replyError: strOrNull(row.reply_error),
  };
}

export function messageOf(row: Record<string, unknown>): CouncilMessage | null {
  const text = str(row.text);
  if (typeof row.id !== 'string' || !text) return null;
  return {
    id: row.id,
    role: row.role === 'advisor' ? 'advisor' : 'person',
    text,
    receipts: receiptsOf(row.receipts),
    createdAt: str(row.created_at),
    noteId: strOrNull(row.note_id),
  };
}

export function memoryOf(row: Record<string, unknown>): CouncilMemory | null {
  const text = str(row.text);
  const kind = MEMORY_KINDS.find((k) => k === row.kind);
  if (typeof row.id !== 'string' || !text || !kind) return null;
  return {
    id: row.id,
    kind,
    text,
    dueOn: strOrNull(row.due_on),
    doneAt: strOrNull(row.done_at),
    createdAt: str(row.created_at),
  };
}

/**
 * What the chat's reply state means now: a reply still waiting past the
 * stale mark has stopped, and reads as failed so the person can send again.
 */
export function replyState(
  chat: CouncilChat | null,
  now: number,
): { kind: 'idle' } | { kind: 'waiting' } | { kind: 'failed'; error: string } {
  if (!chat || chat.replyStatus === 'idle') return { kind: 'idle' };
  if (chat.replyStatus === 'failed') return { kind: 'failed', error: chat.replyError ?? 'The reply was not written.' };
  const since = chat.replyRequestedAt ? Date.parse(chat.replyRequestedAt) : NaN;
  if (Number.isFinite(since) && now - since > REPLY_STALE_AFTER_MS) return { kind: 'failed', error: STALE_REPLY_ERROR };
  return { kind: 'waiting' };
}


/** The newest note per mentor from notes newest first. */
export function newestByAdvisor(notes: readonly CouncilNote[]): Map<string, CouncilNote> {
  const out = new Map<string, CouncilNote>();
  for (const note of notes) if (!out.has(note.advisorId)) out.set(note.advisorId, note);
  return out;
}

/** Unread notes, oldest first, so the one waiting longest is read first. */
export function unreadNotes(notes: readonly CouncilNote[]): CouncilNote[] {
  return notes.filter((n) => !n.readAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** A todo's title from a note: its first sentence, kept to the todo's length. */
export function todoTitleFromNote(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const first = /^(.+?[.!?])(\s|$)/.exec(flat)?.[1] ?? flat;
  return first.length > 200 ? `${first.slice(0, 199)}…` : first;
}

/** A message as it is kept, trimmed, or why it cannot be sent. */
export function cleanMessage(text: string): { ok: true; text: string } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'Write something first.' };
  if (trimmed.length > MESSAGE_MAX) return { ok: false, error: 'Keep a message to at most 4,000 characters.' };
  return { ok: true, text: trimmed };
}

import type { SpendReport } from '@/lib/core/spend/pricing';
import { whenDate, zoneDay } from '@/lib/core/when';
import { addDays } from '@/lib/todo/tasks/model';
import { wallClockToInstant } from '@/lib/todo/time';

/**
 * The weekly check of Ask Dash replies that went badly (plan #2285.3).
 *
 * Each Monday the past week's Ask Dash chats, Monday to Sunday New York time,
 * are read by Haiku for moments the person pushed back, repeated themselves or
 * gave up. Those, and every reply they marked down that week, become one note
 * in Dev notes with a line per reply and a link to its chat, so the notes run
 * can fix what Dash got wrong. core.ask_reply_checks holds one row per week,
 * which is what keeps a second call that week from writing anything; a quiet
 * week writes the row and no note.
 *
 * The rules here are pure. The model call is ./reply-check-model.ts and the
 * ports are filled in by inngest/core/ask-reply-check.ts.
 */

/** The zone the week is counted in. */
export const REPLY_CHECK_ZONE = 'America/New_York';

/** How much of each Dash answer the check reads. The person's turns go in whole. */
export const DASH_TURN_CHARS = 600;

/** One call reads at most this many characters of transcript; more is split. */
export const MAX_CALL_CHARS = 300_000;

/** How much of what was said a note line quotes. */
const QUOTE_CHARS = 140;

/** The longest note feedback_items keeps. */
const MAX_NOTE_CHARS = 4000;

/** Why a reply is listed. */
export type FlagKind = 'down' | 'pushed_back' | 'repeated' | 'gave_up';

/** The kinds the model may give. A thumbs-down comes from the person, never from it. */
export const MODEL_KINDS = ['pushed_back', 'repeated', 'gave_up'] as const;

const KIND_WORDS: Record<FlagKind, string> = {
  down: 'marked down',
  pushed_back: 'pushed back',
  repeated: 'repeated yourself',
  gave_up: 'gave up',
};

/** One turn as the check reads it. */
export type CheckTurn = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  body: string;
  createdAt: string;
};

/** One chat of the week: its turns in the week, oldest first. */
export type CheckChat = { id: string; turns: CheckTurn[] };

/** A thumbs-down given in the week, with what the person had asked before it. */
export type ThumbsDown = {
  turnId: string;
  conversationId: string;
  /** When the answer was written. */
  createdAt: string;
  /** What they typed with the thumb, if anything. */
  note: string | null;
  /** The person's turn just before the answer, if there is one. */
  asked: string | null;
};

/** One flagged reply, as stored in core.ask_reply_checks.flagged. */
export type Flag = {
  turn_id: string;
  conversation_id: string;
  kind: FlagKind;
  /** What the person said: their words with the thumb, or the words that showed it. */
  quote: string;
};

/** A flag with the time it is listed under. */
export type DatedFlag = Flag & { at: string };

// The week -------------------------------------------------------------------

/**
 * The last whole Monday-to-Sunday week before `now`, by its Monday. On a
 * Monday that is the week that ended at midnight, which is the one the Monday
 * call is about.
 */
export function weekToCheck(now: Date, timezone: string = REPLY_CHECK_ZONE): string {
  const today = zoneDay(now, timezone);
  const sinceMonday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(today, -sinceMonday - 7);
}

/** The week's edges: local midnight on its Monday to local midnight a week later. */
export function checkWindow(week: string, timezone: string = REPLY_CHECK_ZONE): { from: string; to: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || new Date(`${week}T00:00:00Z`).getUTCDay() !== 1) {
    throw new Error(`A checked week starts on a Monday, not ${week}.`);
  }
  return {
    from: wallClockToInstant(week, '00:00', timezone),
    to: wallClockToInstant(addDays(week, 7), '00:00', timezone),
  };
}

// The chats ------------------------------------------------------------------

/**
 * The week's turns grouped into the chats the check reads: Ask Dash chats
 * only, and none Dash handed to the backup routine, since that routine files
 * a note of its own for each. Turns outside the window are left out. A chat
 * with no turn of the person's has nothing to push back with and is dropped.
 */
export function chatsToCheck(
  turns: readonly CheckTurn[],
  askChats: ReadonlySet<string>,
  handedOff: ReadonlySet<string>,
  window: { from: string; to: string },
): CheckChat[] {
  const from = Date.parse(window.from);
  const to = Date.parse(window.to);
  const chats = new Map<string, CheckTurn[]>();
  for (const turn of turns) {
    if (!askChats.has(turn.conversationId) || handedOff.has(turn.conversationId)) continue;
    const at = Date.parse(turn.createdAt);
    if (!(at >= from && at < to)) continue;
    const list = chats.get(turn.conversationId) ?? [];
    list.push(turn);
    chats.set(turn.conversationId, list);
  }
  return [...chats.entries()]
    .map(([id, list]) => ({
      id,
      turns: [...list].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    }))
    .filter((chat) => chat.turns.some((turn) => turn.role === 'user'))
    .sort((a, b) => Date.parse(a.turns[0].createdAt) - Date.parse(b.turns[0].createdAt));
}

/** One model call's worth of chats, with the labels it names turns by. */
export type CheckBatch = {
  text: string;
  /** Label (T1, T2, ...) to turn. */
  labels: Map<string, CheckTurn>;
};

function chatText(chat: CheckChat, label: (turn: CheckTurn) => string): string {
  const lines = chat.turns.map((turn) => {
    const body =
      turn.role === 'assistant' && turn.body.length > DASH_TURN_CHARS
        ? `${turn.body.slice(0, DASH_TURN_CHARS)}…`
        : turn.body;
    return `[${label(turn)}] ${turn.role === 'user' ? 'Person' : 'Dash'}: ${body}`;
  });
  return `=== Chat ===\n${lines.join('\n')}`;
}

/**
 * The chats as transcripts, the person's turns whole and each Dash turn cut to
 * its first 600 characters, split into calls of at most 300,000 characters. A
 * single chat longer than that goes in a call of its own.
 */
export function batchChats(chats: readonly CheckChat[], maxChars: number = MAX_CALL_CHARS): CheckBatch[] {
  const batches: CheckBatch[] = [];
  let current: CheckBatch = { text: '', labels: new Map() };
  let counter = 0;
  for (const chat of chats) {
    const labels = new Map<string, CheckTurn>();
    const text = chatText(chat, (turn) => {
      counter += 1;
      const label = `T${counter}`;
      labels.set(label, turn);
      return label;
    });
    if (current.text && current.text.length + text.length + 2 > maxChars) {
      batches.push(current);
      current = { text: '', labels: new Map() };
    }
    current.text = current.text ? `${current.text}\n\n${text}` : text;
    for (const [label, turn] of labels) current.labels.set(label, turn);
  }
  if (current.text) batches.push(current);
  return batches;
}

// What the model returns -----------------------------------------------------

/** One flag as the model gives it, unchecked. */
export type RawFlag = { reply?: unknown; kind?: unknown; quote?: unknown };

function clip(text: string, max: number = QUOTE_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/**
 * The model's flags, checked against the batch. A flag must name a Dash turn
 * by its label and give one of the three kinds. The quote is the person's
 * words; when the model gives none, the person's next turn in the chat stands
 * in for it.
 */
export function readFlags(raw: unknown, batch: CheckBatch): DatedFlag[] {
  if (!Array.isArray(raw)) return [];
  const turns = [...batch.labels.values()];
  const out: DatedFlag[] = [];
  const seen = new Set<string>();
  for (const item of raw as RawFlag[]) {
    if (!item || typeof item !== 'object') continue;
    const turn = typeof item.reply === 'string' ? batch.labels.get(item.reply.trim()) : undefined;
    if (!turn || turn.role !== 'assistant' || seen.has(turn.id)) continue;
    const kind = MODEL_KINDS.find((k) => k === item.kind);
    if (!kind) continue;
    let quote = typeof item.quote === 'string' ? clip(item.quote) : '';
    if (!quote) {
      const next = turns.find(
        (other) =>
          other.conversationId === turn.conversationId &&
          other.role === 'user' &&
          Date.parse(other.createdAt) > Date.parse(turn.createdAt),
      );
      quote = next ? clip(next.body) : '';
    }
    seen.add(turn.id);
    out.push({ turn_id: turn.id, conversation_id: turn.conversationId, kind, quote, at: turn.createdAt });
  }
  return out;
}

/**
 * Every thumbs-down, whatever the check says, then each flag the model gave
 * on a reply not already marked down, oldest first. A thumbs-down is quoted
 * by what they typed with it, or failing that by what they had asked.
 */
export function mergeFlags(downs: readonly ThumbsDown[], flags: readonly DatedFlag[]): DatedFlag[] {
  const merged = new Map<string, DatedFlag>();
  for (const down of downs) {
    merged.set(down.turnId, {
      turn_id: down.turnId,
      conversation_id: down.conversationId,
      kind: 'down',
      quote: clip(down.note?.trim() ? down.note : (down.asked ?? '')),
      at: down.createdAt,
    });
  }
  for (const flag of flags) if (!merged.has(flag.turn_id)) merged.set(flag.turn_id, flag);
  return [...merged.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

// The note -------------------------------------------------------------------

/** The note's heading, which names the week by its Monday. */
export function noteHeading(week: string): string {
  return `Ask Dash replies that went badly, week of ${whenDate(week, { timeZone: 'UTC', month: 'long' })}`;
}

/** One reply's line: the day, why it is listed, what was said, and its chat. */
export function noteLine(flag: DatedFlag, timezone: string = REPLY_CHECK_ZONE): string {
  const why =
    flag.kind === 'down'
      ? flag.quote
        ? `you marked it down: "${flag.quote}"`
        : 'you marked it down'
      : flag.quote
        ? `you ${KIND_WORDS[flag.kind]}: "${flag.quote}"`
        : `you ${KIND_WORDS[flag.kind]}`;
  return `- ${whenDate(flag.at, { timeZone: timezone, weekday: 'short', year: 'never' })}, ${why}. /ask/${flag.conversation_id}`;
}

/**
 * The note: the heading, then a line per reply. A week with more than fits
 * in a note ends with how many were left out.
 */
export function noteBody(week: string, flags: readonly DatedFlag[], timezone: string = REPLY_CHECK_ZONE): string {
  const heading = noteHeading(week);
  const lines = flags.map((flag) => noteLine(flag, timezone));
  let body = `${heading}\n\n${lines.join('\n')}`;
  if (body.length <= MAX_NOTE_CHARS) return body;
  for (let kept = lines.length - 1; kept >= 0; kept -= 1) {
    const rest = lines.length - kept;
    body = `${heading}\n\n${lines.slice(0, kept).join('\n')}\n- And ${rest} more, kept with this week's check.`;
    if (body.length <= MAX_NOTE_CHARS) return body;
  }
  return heading;
}

// The run --------------------------------------------------------------------

export type ReplyCheckPorts = {
  /** Whether this week's check is already stored. */
  hasCheck(userId: string, week: string): Promise<boolean>;
  /** The week's Ask Dash chats, without those handed to the backup routine. */
  chats(userId: string, window: { from: string; to: string }): Promise<CheckChat[]>;
  /** Every thumbs-down given in the window. */
  thumbsDown(userId: string, window: { from: string; to: string }): Promise<ThumbsDown[]>;
  /** The model's flags for one batch, unchecked; null when there is no model to ask. */
  check(batch: CheckBatch, onSpend: (report: SpendReport) => void): Promise<{ model: string; flags: unknown } | null>;
  /** What a model call cost, against this person. */
  ledger(userId: string, report: SpendReport): Promise<void>;
  /** Stores the week's row; false when one was already there. */
  claim(row: { user_id: string; week: string; model: string; flagged: Flag[] }): Promise<boolean>;
  /** Writes the Dev note and returns its id. */
  writeNote(userId: string, body: string): Promise<string>;
  /** Points the week's row at its note. */
  linkNote(userId: string, week: string, noteId: string): Promise<void>;
  /** Takes the week's row back, when its note could not be written, so a later call tries again. */
  release(userId: string, week: string): Promise<void>;
};

export type ReplyCheckResult =
  | { status: 'already-checked'; week: string }
  | { status: 'quiet'; week: string; chats: number }
  | { status: 'noted'; week: string; chats: number; flagged: number; noteId: string };

/** The model id stored when no call was made. */
export const NO_MODEL = 'none';

/**
 * One person's check of the week just gone. The model calls come first; a
 * call that fails throws, after its spend is recorded, and nothing is stored,
 * so the second call of the Monday tries again. The row is claimed before the
 * note is written, so two calls racing write one note between them.
 */
export async function runReplyCheckFor(
  ports: ReplyCheckPorts,
  userId: string,
  now: Date,
): Promise<ReplyCheckResult> {
  const week = weekToCheck(now);
  if (await ports.hasCheck(userId, week)) return { status: 'already-checked', week };

  const window = checkWindow(week);
  const [chats, downs] = await Promise.all([ports.chats(userId, window), ports.thumbsDown(userId, window)]);

  let model = NO_MODEL;
  const found: DatedFlag[] = [];
  const reports: SpendReport[] = [];
  try {
    for (const batch of batchChats(chats)) {
      const reply = await ports.check(batch, (report) => reports.push(report));
      if (!reply) break;
      model = reply.model;
      found.push(...readFlags(reply.flags, batch));
    }
  } finally {
    for (const report of reports) await ports.ledger(userId, report);
  }

  const flags = mergeFlags(downs, found);
  const flagged: Flag[] = flags.map(({ turn_id, conversation_id, kind, quote }) => ({
    turn_id,
    conversation_id,
    kind,
    quote,
  }));
  if (!(await ports.claim({ user_id: userId, week, model, flagged }))) {
    return { status: 'already-checked', week };
  }
  if (flags.length === 0) return { status: 'quiet', week, chats: chats.length };

  let noteId: string;
  try {
    noteId = await ports.writeNote(userId, noteBody(week, flags));
  } catch (err) {
    await ports.release(userId, week);
    throw err;
  }
  await ports.linkNote(userId, week, noteId);
  return { status: 'noted', week, chats: chats.length, flagged: flags.length, noteId };
}

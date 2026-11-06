import type Anthropic from '@anthropic-ai/sdk';
import { parseRef, toRef } from '@/lib/core/refs';

/**
 * Handing a request Ask Dash cannot do to the backup routine (plan #1402).
 *
 * Dash's tools are a short list: the lookups, four proposals and nothing
 * else. When the person asks for something outside them ("add a goal to
 * publish a song"), Dash used to say it could not. Now it calls `hand_off`:
 * the request is kept in core.dash_handoffs, Dash says it has passed it on,
 * and once the answer is written a Claude Code routine is started on it. The
 * routine follows .claude/skills/dash-backup, does the work through the
 * database, writes its reply into the same conversation, and files a note
 * naming the ability Dash lacked so it can be given to Dash directly.
 *
 * This file is the part with no database: the tool, reading its input, and
 * the brief the routine is started with.
 */

export const HAND_OFF_TOOL_NAME = 'hand_off';

export type DashHandoffStatus = 'pending' | 'fired' | 'done' | 'failed';

export type DashHandoff = {
  id: string;
  conversationId: string;
  /** Dash's turn that announced it; null until that turn is written. */
  turnId: string | null;
  request: string;
  /**
   * The row the request is about, as a ref (`schema.table:id`), when Dash
   * named one it had seen (plan #1568). That row reads "Dash is on it" while
   * the hand-off is open. Null when the request is not about one row.
   */
  subjectRef: string | null;
  status: DashHandoffStatus;
  runId: string | null;
  error: string | null;
  createdAt: string;
};

/** The longest request kept (dash_handoffs_request_ck). */
export const MAX_HANDOFF_REQUEST = 4000;

export const HAND_OFF_TOOL: Anthropic.Tool = {
  name: HAND_OFF_TOOL_NAME,
  description:
    "Pass a request on when the person asks you to do or change something and none of your other tools can do it: creating a goal, editing or completing a todo, adding a job application, filing a note, and the like. A routine with full access to their data does it within a few minutes and writes its reply into this conversation. Use it only for a request they actually made, never for a question you could answer by looking things up, and not for deleting anything, sending email or spending money. Write the request so it can be done without this conversation: what to create or change, with every name, date and detail they gave, and the refs of any rows a lookup returned for it.",
  input_schema: {
    type: 'object',
    properties: {
      request: {
        type: 'string',
        description:
          'What to do, complete on its own: "Create a goal \\"Make a new song and publish it on Spotify\\" in their Music area".',
      },
      about: {
        type: 'object',
        description:
          'The one row the request is about, when it is about one: a job application, role, todo, order or item a lookup returned, or the row the page shows. Its page then says Dash is on it until the reply comes. Leave it out when the request is about no single row, such as creating something new.',
        properties: {
          table: { type: 'string', description: 'The table the lookup returned, such as job_search.applications.' },
          ref: { type: 'string', description: 'The ref the lookup returned for the row.' },
        },
        required: ['table', 'ref'],
        additionalProperties: false,
      },
    },
    required: ['request'],
    additionalProperties: false,
  },
};

/**
 * A request for an X post draft is saved by Dash itself with suggest_post
 * (plan #2384.4), so it is never kept as a hand-off.
 */
const POST_REQUEST = /\b(x|twitter|social)\s+posts?\b|\b(draft|write|suggest)\s+(me\s+)?(a|an|some|another)\s+posts?\b|\bposts?\s+about\b|\btweet/i;

export function isPostRequest(request: string): boolean {
  return POST_REQUEST.test(request);
}

/** Said to the model when it tries to hand on a request for a post. */
export const POST_NOT_HANDED_ON =
  'A post is not handed on. Call post_pictures for a picture of the screen, then call suggest_post with the angle, the posts and the picture where one fits.';

/** The longest subject ref kept (dash_handoffs_subject_ref_ck). */
const MAX_SUBJECT_REF = 200;

/**
 * The request out of the tool's input, or why it cannot be used, with the
 * row it is about as a ref. `seen` says whether a lookup in this
 * conversation returned the row, or the page showed it: a row Dash has not
 * seen is left out rather than refusing the request, so a made-up ref never
 * marks a row and the request is still passed on.
 */
export function handoffRequest(
  input: unknown,
  seen: (table: string, ref: string) => boolean = () => false,
): { ok: true; request: string; subjectRef: string | null } | { ok: false; error: string } {
  const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const request = typeof args.request === 'string' ? args.request.trim() : '';
  if (!request) return { ok: false, error: 'request is missing. Say what to do.' };
  if (request.length > MAX_HANDOFF_REQUEST) {
    return { ok: false, error: `request is ${request.length} characters; the most is ${MAX_HANDOFF_REQUEST}.` };
  }
  if (isPostRequest(request)) return { ok: false, error: POST_NOT_HANDED_ON };
  return { ok: true, request, subjectRef: subjectRefOf(args.about, seen) };
}

function subjectRefOf(about: unknown, seen: (table: string, ref: string) => boolean): string | null {
  if (!about || typeof about !== 'object') return null;
  const { table, ref } = about as Record<string, unknown>;
  if (typeof table !== 'string' || typeof ref !== 'string') return null;
  const t = table.trim();
  const r = ref.trim();
  if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(t) || !r || !seen(t, r)) return null;
  const subject = toRef(t, r);
  return subject.length <= MAX_SUBJECT_REF ? subject : null;
}

/** Said to the model when it hands off where there is nothing to hand to. */
export const NO_HANDOFF =
  'Nothing can be handed on from here: the backup routine is not set up on this deployment. Tell them in a sentence that you cannot do this yet.';

/** Said to the model once a hand-off is kept. */
export const HANDED_OFF =
  'Handed on. Tell them in a sentence that you have passed it on and the reply will appear in this conversation in a few minutes. Do not say it is done.';

/**
 * The turn the routine is started with: which hand-off, whose, and in which
 * conversation, then the request itself. The skill reads the row by its id,
 * so the request here is only for the run's own title.
 */
export function handoffBrief(handoff: Pick<DashHandoff, 'id' | 'conversationId' | 'request'>, userId: string): string {
  return [
    `Hand-off ${handoff.id}`,
    `user_id ${userId}`,
    `conversation ${handoff.conversationId}`,
    '',
    `Request: ${handoff.request}`,
  ].join('\n');
}

/*
 * Hand-offs from any bot to a Claude Code session (plan #3005).
 *
 * Kept in the same core.dash_handoffs table under kind 'session' (core
 * migration 0306): any bot, Ask Dash or a person on People in a one-on-one
 * or group chat, hands a request too big for a chat turn to a session. The
 * row holds who sent it, the thread, the person's words, a summary of the
 * thread, the rows that matter, the state, cost and timings. A retried turn
 * sends the same request_key and gets the row already kept.
 */

/** What the person reads a hand-off's progress as (the generated `state` column). */
export type HandoffState = 'queued' | 'running' | 'done' | 'failed';

/** The stored status read as a state: pending is queued, fired is running. */
export function handoffState(status: DashHandoffStatus): HandoffState {
  if (status === 'pending') return 'queued';
  if (status === 'fired') return 'running';
  return status;
}

/** The thread a session hand-off was asked in: an Ask Dash conversation or a People chat. */
export type HandoffThread =
  | { kind: 'ask'; conversationId: string }
  | { kind: 'chat'; chatId: string; advisorId: string };

/** The thread as a ref (`core.conversations:<id>` or `you.advisor_chats:<id>`). */
export function handoffThreadRef(thread: HandoffThread): string {
  return thread.kind === 'ask'
    ? toRef('core.conversations', thread.conversationId)
    : toRef('you.advisor_chats', thread.chatId);
}

/**
 * The key that keeps one request to one row: the thread and the person's
 * message that asked. A retried turn answers the same message, so it sends
 * the same key.
 */
export function handoffKey(thread: HandoffThread, messageId: string): string {
  return `${handoffThreadRef(thread)}#${messageId.trim()}`;
}

/** A row or finding the session should read. */
export type HandoffRef = { ref: string; note?: string };

/** The most refs kept on one hand-off (dash_handoffs_refs_ck). */
export const MAX_HANDOFF_REFS = 50;
/** The longest thread summary kept (dash_handoffs_summary_ck). */
export const MAX_HANDOFF_SUMMARY = 4000;
/** The longest set of the person's own words kept (dash_handoffs_asked_ck, plan #2997). */
export const MAX_HANDOFF_ASKED = 20000;
/** The longest note beside one ref. */
const MAX_REF_NOTE = 500;

export type SessionHandoffInput = {
  thread: HandoffThread;
  /** The person's message that asked, for the key. */
  messageId: string;
  /** The bot's version of the request, complete on its own for the session. */
  request: string;
  /** The person's request in their own words. */
  asked: string;
  /** A short summary of the thread up to the request. */
  summary?: string | null;
  refs?: readonly HandoffRef[];
  /** The row the request is about, which reads "Dash is on it" meanwhile. */
  subjectRef?: string | null;
};

/** The core.dash_handoffs insert for a session hand-off. */
export type SessionHandoffRow = {
  user_id: string;
  kind: 'session';
  conversation_id: string | null;
  advisor_chat_id: string | null;
  advisor_id: string | null;
  message_id: string | null;
  request: string;
  asked: string;
  summary: string | null;
  refs: HandoffRef[];
  subject_ref: string | null;
  request_key: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The row to keep for a session hand-off, or why it cannot be kept. Refs
 * that are not `schema.table:id` are dropped rather than refusing the
 * hand-off, as a made-up subject is (handoffRequest), and the list is cut to
 * the most the table keeps.
 */
export function sessionHandoffRow(
  userId: string,
  input: SessionHandoffInput,
): { ok: true; row: SessionHandoffRow } | { ok: false; error: string } {
  const request = input.request.trim();
  const asked = input.asked.trim();
  const messageId = input.messageId.trim();
  if (!request) return { ok: false, error: 'request is missing. Say what the session should do.' };
  if (request.length > MAX_HANDOFF_REQUEST) {
    return { ok: false, error: `request is ${request.length} characters; the most is ${MAX_HANDOFF_REQUEST}.` };
  }
  if (!asked) return { ok: false, error: "asked is missing: the person's own words." };
  if (!messageId) return { ok: false, error: 'messageId is missing: the message that asked.' };
  const thread = input.thread;
  const threadId = thread.kind === 'ask' ? thread.conversationId : thread.chatId;
  if (!UUID.test(threadId)) return { ok: false, error: 'The thread id is not a uuid.' };
  if (thread.kind === 'chat' && !UUID.test(thread.advisorId)) {
    return { ok: false, error: 'The bot id is not a uuid.' };
  }
  const summary = input.summary?.trim() || null;
  const subject = input.subjectRef?.trim() || null;
  return {
    ok: true,
    row: {
      user_id: userId,
      kind: 'session',
      conversation_id: thread.kind === 'ask' ? thread.conversationId : null,
      advisor_chat_id: thread.kind === 'chat' ? thread.chatId : null,
      advisor_id: thread.kind === 'chat' ? thread.advisorId : null,
      message_id: UUID.test(messageId) ? messageId : null,
      request,
      asked: asked.slice(0, MAX_HANDOFF_ASKED),
      summary: summary ? summary.slice(0, MAX_HANDOFF_SUMMARY) : null,
      refs: cleanRefs(input.refs ?? []),
      subject_ref: subject && subject.length <= MAX_SUBJECT_REF && parseRef(subject) ? subject : null,
      request_key: handoffKey(thread, messageId),
    },
  };
}

function cleanRefs(refs: readonly HandoffRef[]): HandoffRef[] {
  const seen = new Set<string>();
  const out: HandoffRef[] = [];
  for (const item of refs) {
    const ref = typeof item?.ref === 'string' ? item.ref.trim() : '';
    if (!ref || ref.length > MAX_SUBJECT_REF || !parseRef(ref) || seen.has(ref)) continue;
    seen.add(ref);
    const note = typeof item.note === 'string' ? item.note.trim().slice(0, MAX_REF_NOTE) : '';
    out.push(note ? { ref, note } : { ref });
    if (out.length === MAX_HANDOFF_REFS) break;
  }
  return out;
}

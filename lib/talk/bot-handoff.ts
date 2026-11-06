import { createHash } from 'node:crypto';
import { parseRef } from '@/lib/core/refs';

/**
 * Hand-offs from one bot to another (plan #3003), kept in core.bot_handoffs
 * (core migration 0309). The person tells a bot "tell Bob to build it this
 * way"; the sending bot writes one row with the request in the person's
 * words and a packet of what the receiver needs, and the receiving bot
 * marks it picked up, then done with what it did and the row it made.
 *
 * This file is the pure part: the row to insert, the key that keeps one
 * request to one row, and the status moves. lib/talk/bot-handoffs.ts reads
 * and writes the table.
 */

export const BOT_HANDOFF_STATUSES = ['sent', 'picked_up', 'done', 'failed', 'dropped'] as const;
export type BotHandoffStatus = (typeof BOT_HANDOFF_STATUSES)[number];

/** The statuses a hand-off ends in: nothing moves it on from these. */
export const BOT_HANDOFF_ENDED: readonly BotHandoffStatus[] = ['done', 'failed', 'dropped'];

/**
 * The thread the person asked in. Ask Dash is a conversation; a People chat
 * is one-on-one (direct, opened by the bot's key) or a group.
 */
export type BotHandoffSource =
  | { kind: 'ask'; conversationId: string }
  | { kind: 'direct'; chatId: string; botKey: string }
  | { kind: 'group'; chatId: string };

/** The source thread's id. */
export function botHandoffSourceId(source: BotHandoffSource): string {
  return source.kind === 'ask' ? source.conversationId : source.chatId;
}

/** The app path to the source thread, for the receiver to read the whole conversation. */
export function botHandoffSourceLink(source: BotHandoffSource): string {
  if (source.kind === 'ask') return `/chat/dash/${source.conversationId}`;
  if (source.kind === 'direct') return `/chat/people/${encodeURIComponent(source.botKey)}`;
  return `/chat/groups/${source.chatId}`;
}

/** A row or finding the receiver should read. */
export type BotHandoffRef = { ref: string; note?: string };

/** What the sending bot passes on besides the person's words. */
export type BotHandoffPacket = {
  /** A summary of the conversation so far. */
  summary?: string;
  /** Findings that matter, such as research and prices. */
  findings?: string[];
  /** Decisions already made, such as the recommendation taken. */
  decisions?: string[];
  refs?: BotHandoffRef[];
};

/** The longest request in the person's words (bot_handoffs_request_ck). */
export const MAX_BOT_HANDOFF_REQUEST = 20000;
/** The longest summary kept in a packet. */
export const MAX_PACKET_SUMMARY = 4000;
/** The most findings, decisions or refs kept in a packet, each. */
export const MAX_PACKET_ITEMS = 30;
/** The longest single finding or decision. */
const MAX_PACKET_LINE = 1000;
/** The longest ref, and the longest note beside one. */
const MAX_REF = 200;
const MAX_REF_NOTE = 500;
/** The longest result sentence (bot_handoffs_result_ck). */
export const MAX_BOT_HANDOFF_RESULT = 2000;
/** The longest error (bot_handoffs_error_ck). */
export const MAX_BOT_HANDOFF_ERROR = 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABLE = /^[a-z_]+\.[a-z_]+$/;

/** The words of a request as the key reads them: case, spacing and punctuation do not count. */
export function normaliseRequest(request: string): string {
  return request
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * The key that keeps one request to one row: the source thread, the
 * receiving bot and the request's words. The person repeating themselves in
 * the same thread, or a retried turn, sends the same key and gets the row
 * already kept, so the receiver acts once (ties to plan #2988).
 */
export function botHandoffKey(source: BotHandoffSource, toBot: string | null, request: string): string {
  const words = createHash('sha256').update(normaliseRequest(request)).digest('hex').slice(0, 32);
  return `${source.kind}:${botHandoffSourceId(source)}>${toBot ?? 'dash'}#${words}`;
}

export type BotHandoffInput = {
  /** The sending bot (you.board_advisors id); null is Ask Dash. */
  fromBot: string | null;
  /** The receiving bot; null is Ask Dash. */
  toBot: string | null;
  source: BotHandoffSource;
  /** The person's message that asked, when known. */
  sourceMessageId?: string | null;
  /** The person's request in their own words. */
  request: string;
  packet?: BotHandoffPacket;
};

/** The core.bot_handoffs insert. */
export type BotHandoffRow = {
  user_id: string;
  from_bot: string | null;
  to_bot: string | null;
  source_kind: BotHandoffSource['kind'];
  source_id: string;
  source_link: string;
  source_message_id: string | null;
  request: string;
  packet: BotHandoffPacket;
  dedupe_key: string;
};

/**
 * The row to keep for a hand-off, or why it cannot be kept. A packet's
 * empty lines and refs that are not `schema.table:id` are dropped rather
 * than refusing the hand-off, and each list is cut to the most kept.
 */
export function botHandoffRow(
  userId: string,
  input: BotHandoffInput,
): { ok: true; row: BotHandoffRow } | { ok: false; error: string } {
  const request = input.request.trim();
  if (!request) return { ok: false, error: "request is missing: the person's own words." };
  if (request.length > MAX_BOT_HANDOFF_REQUEST) {
    return { ok: false, error: `request is ${request.length} characters; the most is ${MAX_BOT_HANDOFF_REQUEST}.` };
  }
  for (const [name, id] of [['fromBot', input.fromBot], ['toBot', input.toBot]] as const) {
    if (id !== null && !UUID.test(id)) return { ok: false, error: `${name} is not a bot id.` };
  }
  if (input.fromBot === input.toBot) return { ok: false, error: 'A bot cannot hand a request to itself.' };
  const sourceId = botHandoffSourceId(input.source);
  if (!UUID.test(sourceId)) return { ok: false, error: 'The source thread id is not a uuid.' };
  if (input.source.kind === 'direct' && !input.source.botKey.trim()) {
    return { ok: false, error: "The one-on-one chat's bot key is missing." };
  }
  const messageId = input.sourceMessageId?.trim() || null;
  return {
    ok: true,
    row: {
      user_id: userId,
      from_bot: input.fromBot,
      to_bot: input.toBot,
      source_kind: input.source.kind,
      source_id: sourceId,
      source_link: botHandoffSourceLink(input.source),
      source_message_id: messageId && UUID.test(messageId) ? messageId : null,
      request,
      packet: cleanPacket(input.packet ?? {}),
      dedupe_key: botHandoffKey(input.source, input.toBot, request),
    },
  };
}

/** The packet with blanks dropped and every part cut to what is kept. */
export function cleanPacket(packet: BotHandoffPacket): BotHandoffPacket {
  const out: BotHandoffPacket = {};
  const summary = typeof packet.summary === 'string' ? packet.summary.trim() : '';
  if (summary) out.summary = summary.slice(0, MAX_PACKET_SUMMARY);
  const findings = cleanLines(packet.findings);
  if (findings.length) out.findings = findings;
  const decisions = cleanLines(packet.decisions);
  if (decisions.length) out.decisions = decisions;
  const refs = cleanRefs(packet.refs);
  if (refs.length) out.refs = refs;
  return out;
}

function cleanLines(lines: unknown): string[] {
  if (!Array.isArray(lines)) return [];
  const out: string[] = [];
  for (const line of lines) {
    const text = typeof line === 'string' ? line.trim() : '';
    if (!text) continue;
    out.push(text.slice(0, MAX_PACKET_LINE));
    if (out.length === MAX_PACKET_ITEMS) break;
  }
  return out;
}

function cleanRefs(refs: unknown): BotHandoffRef[] {
  if (!Array.isArray(refs)) return [];
  const seen = new Set<string>();
  const out: BotHandoffRef[] = [];
  for (const item of refs as BotHandoffRef[]) {
    const ref = typeof item?.ref === 'string' ? item.ref.trim() : '';
    if (!ref || ref.length > MAX_REF || !parseRef(ref) || seen.has(ref)) continue;
    seen.add(ref);
    const note = typeof item.note === 'string' ? item.note.trim().slice(0, MAX_REF_NOTE) : '';
    out.push(note ? { ref, note } : { ref });
    if (out.length === MAX_PACKET_ITEMS) break;
  }
  return out;
}

/** The row a receiver made, as `schema.table` and id. */
export type BotHandoffResultRow = { table: string; id: string };

/** How a hand-off ends: what the receiver did, or why it did not. */
export type BotHandoffEnd =
  | { status: 'done'; result: string; row?: BotHandoffResultRow | null }
  | { status: 'failed'; error: string }
  | { status: 'dropped'; error?: string | null };

/** The update that ends a hand-off, or why it cannot. */
export function botHandoffEndUpdate(
  end: BotHandoffEnd,
  at: string,
):
  | { ok: true; update: { status: BotHandoffStatus; done_at: string; result?: string; result_table?: string | null; result_id?: string | null; error?: string | null } }
  | { ok: false; error: string } {
  if (end.status === 'done') {
    const result = end.result.trim();
    if (!result) return { ok: false, error: 'result is missing: say what the receiver did.' };
    const row = end.row ?? null;
    if (row && (!TABLE.test(row.table) || !row.id.trim() || row.id.trim().length > 100)) {
      return { ok: false, error: 'The result row is not a schema.table and an id.' };
    }
    return {
      ok: true,
      update: {
        status: 'done',
        done_at: at,
        result: result.slice(0, MAX_BOT_HANDOFF_RESULT),
        result_table: row?.table ?? null,
        result_id: row?.id.trim() ?? null,
      },
    };
  }
  if (end.status === 'failed') {
    const error = end.error.trim();
    if (!error) return { ok: false, error: 'error is missing: say why it failed.' };
    return { ok: true, update: { status: 'failed', done_at: at, error: error.slice(0, MAX_BOT_HANDOFF_ERROR) } };
  }
  const error = end.error?.trim() || null;
  return { ok: true, update: { status: 'dropped', done_at: at, error: error ? error.slice(0, MAX_BOT_HANDOFF_ERROR) : null } };
}

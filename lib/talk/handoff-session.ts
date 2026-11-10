import { costMicrosFor, usageFrom, type TokenUsage } from '@/lib/core/spend/pricing';
import type { HandoffRef } from './handoff';

/**
 * Running a session hand-off as Claude Code (plan #3005.3).
 *
 * A bot's session hand-off (core.dash_handoffs, kind 'session') is started on
 * the Dash backup routine's path (plan #1402): the same routine, fired with a
 * brief, follows .claude/skills/dash-backup/SKILL.md and reads the row by its
 * id. This file is the part with no database: the brief the routine is
 * started with, and what the session cost, read from its own transcript.
 */

/** The parts of a session hand-off its brief names. */
export type SessionBriefHandoff = {
  id: string;
  advisorId: string | null;
  conversationId: string | null;
  advisorChatId: string | null;
  request: string;
  asked: string;
  summary: string | null;
  refs: readonly HandoffRef[];
  /** The bot marked it as needing a web browser (plan #3040.1). */
  browserTask?: boolean;
};

/**
 * The line a browser task's brief carries after `kind session`. The skill's
 * browser section (plan #3040.2) reads it to choose Chrome or headless.
 */
export const BROWSER_TASK_LINE = 'browser task';

/** The most of the person's words the brief carries; the row keeps them all. */
const BRIEF_ASKED = 4000;

/**
 * The turn the backup routine is started with for a session hand-off. It
 * opens with `Hand-off <id>` as a request hand-off's brief does, so the
 * routine's standing prompt sends it to the same skill, then `kind session`,
 * which sends the skill to its section for these, and `browser task` when
 * the bot marked it as needing a browser. The thread, the person's
 * words, the summary and the rows to read follow, so the run has its context
 * before it reads the row.
 */
export function sessionHandoffBrief(handoff: SessionBriefHandoff, userId: string): string {
  const thread = handoff.conversationId
    ? `conversation ${handoff.conversationId}`
    : `chat ${handoff.advisorChatId}, bot ${handoff.advisorId}`;
  const asked = handoff.asked.trim();
  const words =
    asked.length > BRIEF_ASKED ? `${asked.slice(0, BRIEF_ASKED)} [cut here; the row keeps the rest]` : asked;
  const refs = handoff.refs.map((item) => (item.note ? `- ${item.ref}: ${item.note}` : `- ${item.ref}`));
  return [
    `Hand-off ${handoff.id}`,
    'kind session',
    ...(handoff.browserTask ? [BROWSER_TASK_LINE] : []),
    `user_id ${userId}`,
    thread,
    'Follow .claude/skills/dash-backup/SKILL.md, "A session hand-off".',
    '',
    `Asked: ${words}`,
    '',
    `The thread so far: ${handoff.summary?.trim() || 'no summary was kept.'}`,
    '',
    'Rows to read:',
    ...(refs.length > 0 ? refs : ['- none named']),
    '',
    `Request: ${handoff.request}`,
  ].join('\n');
}

/** What one model cost over a session, for one core.model_spend row. */
export type SessionSpend = {
  model: string;
  usage: TokenUsage;
  /** Of usage.cacheWriteTokens, those written with the one-hour lifetime. */
  oneHourCacheWrites: number;
  /** Null when the model has no published rate, as the ledger keeps it. */
  costMicros: number | null;
};

/** The operation a session's spend is kept under in core.model_spend. */
export const SESSION_SPEND_OPERATION = 'hand-off-session';

type Line = {
  type?: unknown;
  message?: { id?: unknown; model?: unknown; usage?: unknown };
};

/**
 * What a Claude Code session cost, from its transcripts: the session's own
 * JSONL and its subagents'. Each assistant message is written as one line per
 * content block, every one carrying the same usage, so a message is counted
 * once by its id, keeping the line with the most output. Summed per model.
 *
 * Claude Code writes its prompt cache with the one-hour lifetime, which
 * costMicrosFor prices at twice input from the usage's hourWriteTokens.
 */
export function transcriptSpend(transcripts: readonly string[]): SessionSpend[] {
  const messages = new Map<string, { model: string; usage: TokenUsage; oneHour: number }>();
  for (const text of transcripts) {
    for (const raw of text.split('\n')) {
      if (!raw.includes('"usage"')) continue;
      let line: Line;
      try {
        line = JSON.parse(raw) as Line;
      } catch {
        continue;
      }
      const message = line.message;
      if (line.type !== 'assistant' || !message || typeof message.id !== 'string') continue;
      const model = typeof message.model === 'string' ? message.model.replace(/\[.*$/, '').trim() : '';
      if (!model || model.startsWith('<')) continue;
      const usage = usageFrom(message.usage);
      const kept = messages.get(message.id);
      if (kept && kept.usage.outputTokens >= usage.outputTokens) continue;
      messages.set(message.id, { model, usage, oneHour: oneHourWrites(message.usage, usage.cacheWriteTokens) });
    }
  }

  const byModel = new Map<string, { usage: TokenUsage; oneHour: number }>();
  for (const { model, usage, oneHour } of messages.values()) {
    const sum = byModel.get(model) ?? {
      usage: { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
      oneHour: 0,
    };
    sum.usage.inputTokens += usage.inputTokens;
    sum.usage.cachedInputTokens += usage.cachedInputTokens;
    sum.usage.cacheWriteTokens += usage.cacheWriteTokens;
    sum.usage.outputTokens += usage.outputTokens;
    const searches = (sum.usage.webSearchRequests ?? 0) + (usage.webSearchRequests ?? 0);
    if (searches > 0) sum.usage.webSearchRequests = searches;
    sum.oneHour += oneHour;
    if (sum.oneHour > 0) sum.usage.hourWriteTokens = sum.oneHour;
    byModel.set(model, sum);
  }

  return [...byModel.entries()]
    .map(([model, { usage, oneHour }]) => ({
      model,
      usage,
      oneHourCacheWrites: oneHour,
      costMicros: sessionCostMicros(model, usage),
    }))
    .sort((a, b) => a.model.localeCompare(b.model));
}

function oneHourWrites(raw: unknown, cacheWrites: number): number {
  const creation = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).cache_creation : null;
  const value =
    creation && typeof creation === 'object' ? (creation as Record<string, unknown>).ephemeral_1h_input_tokens : 0;
  const tokens = typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  return Math.min(tokens, cacheWrites);
}

/** The ledger's price for the usage; its one-hour cache writes are in hourWriteTokens. */
function sessionCostMicros(model: string, usage: TokenUsage): number | null {
  return costMicrosFor(model, usage);
}

/** The session's whole cost, or null when no model in it had a rate. */
export function totalSessionMicros(spend: readonly SessionSpend[]): number | null {
  const priced = spend.filter((row) => row.costMicros !== null);
  if (priced.length === 0) return spend.length === 0 ? 0 : null;
  return priced.reduce((sum, row) => sum + (row.costMicros ?? 0), 0);
}

/*
 * The two statements a session runs on its own hand-off, through
 * scripts/handoff-session.ts. Kept here so the database tests run the same
 * text.
 */

/**
 * The session is still at work: last_seen_at is kept, and a hand-off still
 * queued moves to running. $1 the hand-off, $2 the owner.
 */
export const SEEN_SQL = `update core.dash_handoffs
    set last_seen_at = now(),
        fired_at = coalesce(fired_at, now()),
        status = case when status = 'pending' then 'fired' else status end
  where id = $1 and user_id = $2 and kind = 'session' and status in ('pending', 'fired')
  returning id, state, last_seen_at`;

/**
 * Closes the hand-off done or failed, with what the session cost. Only a
 * hand-off still open is closed, so the call that closes it is the one that
 * writes the spend (SPEND_SQL), and a second close counts nothing. Two
 * statements rather than one with a writing CTE, because the HTTPS path
 * (public.service_sql) runs a statement inside a query, where Postgres
 * refuses one. Parameters from closeParameters. A reply turn written in an
 * Ask Dash conversation has told the thread, so told_at is set with it and
 * the watch (you.watch_bot_pages) leaves the row alone.
 */
export const CLOSE_SQL = `update core.dash_handoffs
     set status = $3, error = $4, finished_at = now(), last_seen_at = now(),
         cost_micros = $5::bigint,
         told_at = case when $6::uuid is not null then now() else told_at end,
         reply_turn_id = coalesce($6::uuid, reply_turn_id),
         note_id = coalesce($7::uuid, note_id)
   where id = $1 and user_id = $2 and kind = 'session' and status in ('pending', 'fired')
   returning id, state, cost_micros, told_at`;

/**
 * The session's cost toward spend: one core.model_spend row per model, under
 * core / hand-off-session. $1 the owner, $2 the rows from spendParameter.
 */
export const SPEND_SQL = `insert into core.model_spend
    (user_id, module, operation, model, input_tokens, cached_input_tokens, cache_write_tokens, output_tokens, cost_micros)
  select $1, 'core', '${SESSION_SPEND_OPERATION}', r.model, r.input_tokens, r.cached_input_tokens,
         r.cache_write_tokens, r.output_tokens, r.cost_micros
    from jsonb_to_recordset($2::text::jsonb) as r(model text, input_tokens int, cached_input_tokens int,
         cache_write_tokens int, output_tokens int, cost_micros bigint)
  returning id`;

/** How a session ends its hand-off. */
export type SessionClose =
  | { outcome: 'done'; replyTurnId?: string | null; noteId?: string | null }
  | { outcome: 'failed'; reason: string; replyTurnId?: string | null; noteId?: string | null };

/** The values for CLOSE_SQL, in order. A failure's reason is kept to 1,000 characters. */
export function closeParameters(
  id: string,
  ownerId: string,
  close: SessionClose,
  spend: readonly SessionSpend[],
): unknown[] {
  return [
    id,
    ownerId,
    close.outcome,
    close.outcome === 'failed' ? close.reason.trim().slice(0, 1000) : null,
    spend.length > 0 ? totalSessionMicros(spend) : null,
    close.replyTurnId ?? null,
    close.noteId ?? null,
  ];
}

/** The rows for SPEND_SQL's $2, one per model. */
export function spendParameter(spend: readonly SessionSpend[]): string {
  return JSON.stringify(
    spend.map((row) => ({
      model: row.model,
      input_tokens: row.usage.inputTokens,
      cached_input_tokens: row.usage.cachedInputTokens,
      cache_write_tokens: row.usage.cacheWriteTokens,
      output_tokens: row.usage.outputTokens,
      cost_micros: row.costMicros,
    })),
  );
}

/*
 * Telling the thread (plan #3005.4). An Ask Dash session writes its own reply
 * turn and passes its id to close. A People chat (one-on-one or group) is
 * told by the bot through you.tell_bot_session: the session's sentence in
 * the bot's voice, its links as the message's receipts, and the Undo as a
 * link to Home, where every change it recorded with core.record_dash_action
 * has one. A failure is told through you.tell_bot_page, with the reason.
 * Whatever a session leaves unsaid, you.watch_bot_pages says: quiet for
 * SESSION_NUDGE_MINUTES is flagged, quiet for SESSION_GIVE_UP_MINUTES is
 * failed and told, and one closed done with nothing posted is reported.
 */

/** Silence, from the last report, before the thread is told it is taking long. */
export const SESSION_NUDGE_MINUTES = 20;
/** Silence before the hand-off is failed and the thread told. */
export const SESSION_GIVE_UP_MINUTES = 90;

/** The hand-off's thread, read before closing so the right telling is checked. $1 id, $2 owner. */
export const THREAD_SQL = `select id, conversation_id, advisor_chat_id, state, browser_task, browser, browser_reason
    from core.dash_handoffs
   where id = $1 and user_id = $2 and kind = 'session'`;

/** Posts a finished session's result in its People chat, once. $1 id, $2 owner, $3 text, $4 receipts. */
export const TELL_DONE_SQL = `select you.tell_bot_session($1::uuid, $2::uuid, $3, $4::text::jsonb) as message_id`;

/** Tells the thread a session failed, with the reason, once. $1 id. */
export const TELL_FAILED_SQL = `select you.tell_bot_page($1::uuid) as message_id`;

/** A link under the bot's message: the People thread shows each under the text. */
export type SessionReceipt = { label: string; link: string };

/** Where every change Dash recorded today has its Undo (app/home/dash-today.tsx). */
export const UNDO_RECEIPT: SessionReceipt = { label: 'Undo on Home', link: '/home#dash-today' };

const MAX_RECEIPTS = 8;
const MAX_LABEL = 120;
const MAX_REPLY = 20000;

/**
 * The receipts for a People post, from `--link "<label>=<path>"` values and
 * whether any change was recorded (the Undo). A link is a path in the app,
 * so nothing posted points outside it.
 */
export function sessionReceipts(
  links: readonly string[],
  undo: boolean,
): { ok: true; receipts: SessionReceipt[] } | { ok: false; error: string } {
  const receipts: SessionReceipt[] = [];
  for (const value of links) {
    const at = value.lastIndexOf('=');
    const label = at > 0 ? value.slice(0, at).trim() : '';
    const link = at > 0 ? value.slice(at + 1).trim() : '';
    if (!label || !link) return { ok: false, error: `--link "${value}" is not "<label>=<path>".` };
    if (!link.startsWith('/') || link.startsWith('//')) {
      return { ok: false, error: `--link "${value}" is not a path in the app, such as /goals/<id>.` };
    }
    receipts.push({ label: label.slice(0, MAX_LABEL), link });
  }
  if (undo) receipts.push(UNDO_RECEIPT);
  if (receipts.length > MAX_RECEIPTS) return { ok: false, error: `At most ${MAX_RECEIPTS} links, the Undo among them.` };
  return { ok: true, receipts };
}

/** Where the hand-off was asked, as THREAD_SQL reads it. */
export type SessionThread = { conversationId: string | null; advisorChatId: string | null };

/**
 * Why a close would leave the thread without its result, or null when it
 * would not. Done in an Ask Dash conversation needs the reply turn; done in
 * a People chat needs the reply text. A failure needs neither: the reason
 * is told for it.
 */
export function closeRefusal(
  thread: SessionThread,
  close: SessionClose,
  reply: string | null,
): string | null {
  if (close.outcome === 'failed') return null;
  if (thread.conversationId && !close.replyTurnId) {
    return 'An Ask Dash hand-off closes done with --reply-turn <id>: write the reply turn first, so the thread hears what you did.';
  }
  if (thread.advisorChatId) {
    const text = reply?.trim() ?? '';
    if (!text) {
      return 'A People hand-off closes done with --reply "<what you did, in the bot\'s voice>", so the thread hears it.';
    }
    if (text.length > MAX_REPLY) return `The reply is over ${MAX_REPLY} characters.`;
  }
  return null;
}

import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { CORE_SCHEMA, type CoreSupabaseClient } from '@/lib/core/db/schema-name';
import {
  botHandoffEndUpdate,
  botHandoffRow,
  type BotHandoffEnd,
  type BotHandoffInput,
  type BotHandoffPacket,
  type BotHandoffSource,
  type BotHandoffStatus,
} from './bot-handoff';

/**
 * Reading and writing core.bot_handoffs (plan #3003.1): one row per request
 * one bot passes to another. The sender keeps it with keepBotHandoff; the
 * receiver claims it with pickUpBotHandoff and closes it with
 * endBotHandoff. Every call is scoped to the person's own rows.
 */

/** A hand-off as the bots read it. */
export type BotHandoff = {
  id: string;
  fromBot: string | null;
  toBot: string | null;
  sourceKind: BotHandoffSource['kind'];
  sourceId: string;
  sourceLink: string;
  sourceMessageId: string | null;
  request: string;
  packet: BotHandoffPacket;
  status: BotHandoffStatus;
  sentAt: string;
  pickedUpAt: string | null;
  doneAt: string | null;
  result: string | null;
  resultTable: string | null;
  resultId: string | null;
  error: string | null;
  dedupeKey: string;
};

const SELECT =
  'id, from_bot, to_bot, source_kind, source_id, source_link, source_message_id, request, packet, status, sent_at, picked_up_at, done_at, result, result_table, result_id, error, dedupe_key';

type DbRow = {
  id: string;
  from_bot: string | null;
  to_bot: string | null;
  source_kind: BotHandoffSource['kind'];
  source_id: string;
  source_link: string;
  source_message_id: string | null;
  request: string;
  packet: BotHandoffPacket | null;
  status: BotHandoffStatus;
  sent_at: string;
  picked_up_at: string | null;
  done_at: string | null;
  result: string | null;
  result_table: string | null;
  result_id: string | null;
  error: string | null;
  dedupe_key: string;
};

export function toBotHandoff(row: DbRow): BotHandoff {
  return {
    id: row.id,
    fromBot: row.from_bot,
    toBot: row.to_bot,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    sourceLink: row.source_link,
    sourceMessageId: row.source_message_id,
    request: row.request,
    packet: row.packet && typeof row.packet === 'object' && !Array.isArray(row.packet) ? row.packet : {},
    status: row.status,
    sentAt: row.sent_at,
    pickedUpAt: row.picked_up_at,
    doneAt: row.done_at,
    result: row.result,
    resultTable: row.result_table,
    resultId: row.result_id,
    error: row.error,
    dedupeKey: row.dedupe_key,
  };
}

/** The hand-off kept under one key, or null. */
export async function loadBotHandoffByKey(
  core: CoreSupabaseClient,
  userId: string,
  dedupeKey: string,
): Promise<BotHandoff | null> {
  const { data, error } = await core
    .from('bot_handoffs')
    .select(SELECT)
    .eq('user_id', userId)
    .eq('dedupe_key', dedupeKey)
    .maybeSingle();
  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Reading the hand-off failed: ${error.message}`);
  return data ? toBotHandoff(data as DbRow) : null;
}

/**
 * Keeps a request one bot passes to another, once per request. A repeated
 * or retried request sends the same key: the insert is skipped on the
 * unique (user_id, dedupe_key) and the row already kept comes back with
 * `created: false`, so the sender sends nothing twice.
 */
export async function keepBotHandoff(
  core: CoreSupabaseClient,
  userId: string,
  input: BotHandoffInput,
): Promise<{ ok: true; handoff: BotHandoff; created: boolean } | { ok: false; error: string }> {
  const built = botHandoffRow(userId, input);
  if (!built.ok) return built;
  const { data, error } = await core
    .from('bot_handoffs')
    .upsert(built.row, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true })
    .select(SELECT);
  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Keeping the hand-off failed: ${error.message}`);
  const inserted = ((data ?? []) as DbRow[])[0];
  if (inserted) return { ok: true, handoff: toBotHandoff(inserted), created: true };
  const kept = await loadBotHandoffByKey(core, userId, built.row.dedupe_key);
  if (!kept) throw new Error('Keeping the hand-off failed: the row under its key was not found.');
  return { ok: true, handoff: kept, created: false };
}

/**
 * Marks a hand-off picked up by its receiver. Only a sent one moves, so two
 * receivers starting at once leave one claim: the other gets null.
 */
export async function pickUpBotHandoff(
  core: CoreSupabaseClient,
  userId: string,
  id: string,
  at = new Date().toISOString(),
): Promise<BotHandoff | null> {
  const { data, error } = await core
    .from('bot_handoffs')
    .update({ status: 'picked_up', picked_up_at: at })
    .eq('id', id)
    .eq('user_id', userId)
    .eq('status', 'sent')
    .select(SELECT);
  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Picking up the hand-off failed: ${error.message}`);
  const row = ((data ?? []) as DbRow[])[0];
  return row ? toBotHandoff(row) : null;
}

/**
 * Ends a hand-off: done with what the receiver did and the row it made,
 * failed with why, or dropped. One already ended is left as it is, and
 * null comes back.
 */
export async function endBotHandoff(
  core: CoreSupabaseClient,
  userId: string,
  id: string,
  end: BotHandoffEnd,
  at = new Date().toISOString(),
): Promise<{ ok: true; handoff: BotHandoff | null } | { ok: false; error: string }> {
  const built = botHandoffEndUpdate(end, at);
  if (!built.ok) return built;
  const { data, error } = await core
    .from('bot_handoffs')
    .update(built.update)
    .eq('id', id)
    .eq('user_id', userId)
    .in('status', ['sent', 'picked_up'])
    .select(SELECT);
  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Ending the hand-off failed: ${error.message}`);
  const row = ((data ?? []) as DbRow[])[0];
  return { ok: true, handoff: row ? toBotHandoff(row) : null };
}

/** The hand-offs waiting on one bot (null is Ask Dash), oldest first. */
export async function loadWaitingBotHandoffs(
  core: CoreSupabaseClient,
  userId: string,
  toBot: string | null,
  limit = 20,
): Promise<BotHandoff[]> {
  let query = core.from('bot_handoffs').select(SELECT).eq('user_id', userId).in('status', ['sent', 'picked_up']);
  query = toBot === null ? query.is('to_bot', null) : query.eq('to_bot', toBot);
  const { data, error } = await query.order('sent_at', { ascending: true }).limit(limit);
  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Reading the hand-offs failed: ${error.message}`);
  return ((data ?? []) as DbRow[]).map(toBotHandoff);
}

/** The hand-offs asked in one thread, newest first. */
export async function loadSourceBotHandoffs(
  core: CoreSupabaseClient,
  userId: string,
  sourceId: string,
  limit = 20,
): Promise<BotHandoff[]> {
  const { data, error } = await core
    .from('bot_handoffs')
    .select(SELECT)
    .eq('user_id', userId)
    .eq('source_id', sourceId)
    .order('sent_at', { ascending: false })
    .limit(limit);
  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Reading the hand-offs failed: ${error.message}`);
  return ((data ?? []) as DbRow[]).map(toBotHandoff);
}

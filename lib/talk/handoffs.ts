import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { CORE_SCHEMA, type CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { createCoreClient } from '@/lib/core/auth/server';
import {
  runSubjectRefs,
  type GoingContext,
  type GoingGoalsItem,
  type GoingGoalsRun,
} from '@/lib/core/run-going';
import {
  handoffState,
  sessionHandoffRow,
  type DashHandoff,
  type HandoffRef,
  type HandoffState,
  type HandoffThread,
  type SessionHandoffInput,
} from './handoff';

/**
 * The requests Ask Dash handed to the backup routine (plan #1402), kept in
 * core.dash_handoffs (core migration 0143). Every read and write goes
 * through the person's own client, so RLS keeps them to their rows.
 */

const SELECT = 'id, conversation_id, turn_id, request, subject_ref, status, run_id, error, created_at';

type HandoffRow = {
  id: string;
  conversation_id: string;
  turn_id: string | null;
  request: string;
  subject_ref: string | null;
  status: DashHandoff['status'];
  run_id: string | null;
  error: string | null;
  created_at: string;
};

function toHandoff(row: HandoffRow): DashHandoff {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    turnId: row.turn_id,
    request: row.request,
    subjectRef: row.subject_ref ?? null,
    status: row.status,
    runId: row.run_id,
    error: row.error,
    createdAt: row.created_at,
  };
}

/** Keeps a request as pending, before the answer that hands it on is written. */
export async function insertHandoff(
  core: CoreSupabaseClient,
  userId: string,
  conversationId: string,
  request: string,
  subjectRef: string | null = null,
): Promise<DashHandoff> {
  const { data, error } = await core
    .from('dash_handoffs')
    .insert({ user_id: userId, conversation_id: conversationId, request, subject_ref: subjectRef })
    .select(SELECT)
    .single();
  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Keeping the hand-off failed: ${error.message}`);
  return toHandoff(data as HandoffRow);
}

/** Ties hand-offs to the answer that announced them. */
export async function attachHandoffs(core: CoreSupabaseClient, ids: readonly string[], turnId: string): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await core.from('dash_handoffs').update({ turn_id: turnId }).in('id', [...ids]).is('turn_id', null);
  if (error) throw new Error(`Tying the hand-off to the answer failed: ${error.message}`);
}

/** Removes the hand-offs of an answer that was not kept, so nothing is started for it. */
export async function discardHandoffs(core: CoreSupabaseClient, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await core.from('dash_handoffs').delete().in('id', [...ids]).eq('status', 'pending');
  if (error) throw new Error(`Removing the hand-off failed: ${error.message}`);
}

/**
 * The hand-offs of one conversation still waiting on the routine. Ask's
 * own rows only: a conversation id is set on Ask's request rows and on the
 * session rows Ask Dash hands on (plan #3005.2), whose session writes its
 * reply into this conversation, so the thread keeps checking for it. A
 * People hand-off has no conversation id and is never read here.
 */
export async function loadOpenHandoffs(core: CoreSupabaseClient, conversationId: string): Promise<DashHandoff[]> {
  const { data, error } = await core
    .from('dash_handoffs')
    .select(SELECT)
    .eq('conversation_id', conversationId)
    .in('status', ['pending', 'fired'])
    .order('created_at', { ascending: true });
  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Reading the hand-offs failed: ${error.message}`);
  return ((data ?? []) as HandoffRow[]).map(toHandoff);
}

/**
 * The rows an open hand-off or a run still going is about, as refs (plans
 * #1568 and #1964.2.2): what the Jobs, Todo, Shopping, Learn, vault and News
 * pages read to say "Dash is on it" on those rows. A failed read gives none,
 * so the page still renders with each row's own move.
 */
export async function loadWorkingRefs(core: CoreSupabaseClient, userId: string): Promise<string[]> {
  const [handoffs, runs] = await Promise.all([loadHandoffRefs(core, userId), loadRunRefs(core, userId)]);
  return [...new Set([...handoffs, ...runs])];
}

/** The one status a runs row is going in (runStatusGoing, lib/core/run-going.ts). */
const GOING = 'started';

/**
 * The refs of the plan and goals runs still going (lib/core/run-going.ts
 * says what each is about). Read through the same client, since RLS keeps
 * both runs tables and goals.context to the person's rows.
 */
async function loadRunRefs(core: CoreSupabaseClient, userId: string): Promise<string[]> {
  try {
    const goals = core.schema('goals');
    const [plan, going] = await Promise.all([
      core.schema('public').from('plan_runs').select('plan_item_id').eq('user_id', userId).eq('status', GOING).limit(50),
      goals.from('runs').select('item_id, area_id').eq('user_id', userId).eq('status', GOING).limit(50),
    ]);
    if (plan.error) console.error('the plan runs going were not read', plan.error.message);
    if (going.error) console.error('the goals runs going were not read', going.error.message);
    const goalsRuns = (going.data ?? []) as GoingGoalsRun[];
    const itemIds = [...new Set(goalsRuns.flatMap((run) => (run.item_id ? [run.item_id] : [])))];
    let goalsItems: GoingGoalsItem[] = [];
    let context: GoingContext[] = [];
    if (itemIds.length > 0) {
      const items = await goals.from('items').select('id, parent_id').in('id', itemIds);
      goalsItems = (items.data ?? []) as GoingGoalsItem[];
      const goalIds = [...new Set([...itemIds, ...goalsItems.flatMap((item) => (item.parent_id ? [item.parent_id] : []))])];
      const found = await goals.from('context').select('item_id, source, ref, status').in('item_id', goalIds).limit(500);
      context = (found.data ?? []) as GoingContext[];
    }
    return runSubjectRefs({
      planItemIds: ((plan.data ?? []) as { plan_item_id: string | null }[]).map((run) => run.plan_item_id),
      goalsRuns,
      goalsItems,
      context,
    });
  } catch (error) {
    console.error('the runs going were not read', error);
    return [];
  }
}

async function loadHandoffRefs(core: CoreSupabaseClient, userId: string): Promise<string[]> {
  try {
    const { data, error } = await core
      .from('dash_handoffs')
      .select('subject_ref')
      .eq('user_id', userId)
      .in('status', ['pending', 'fired'])
      .not('subject_ref', 'is', null)
      .limit(200);
    if (error) {
      console.error('the open hand-offs were not read', error.message);
      return [];
    }
    return [...new Set(((data ?? []) as { subject_ref: string | null }[]).flatMap((r) => (r.subject_ref ? [r.subject_ref] : [])))];
  } catch (error) {
    console.error('the open hand-offs were not read', error);
    return [];
  }
}

/** A session hand-off as the bots and the routine read it (plan #3005.1). */
export type SessionHandoff = {
  id: string;
  /** The bot that sent it (you.board_advisors); null is Ask Dash. */
  advisorId: string | null;
  conversationId: string | null;
  advisorChatId: string | null;
  request: string;
  asked: string;
  summary: string | null;
  refs: HandoffRef[];
  subjectRef: string | null;
  requestKey: string;
  state: HandoffState;
  runId: string | null;
  error: string | null;
  costMicros: number | null;
  createdAt: string;
  firedAt: string | null;
  finishedAt: string | null;
  lastSeenAt: string | null;
};

const SESSION_SELECT =
  'id, advisor_id, conversation_id, advisor_chat_id, request, asked, summary, refs, subject_ref, request_key, status, run_id, error, cost_micros, created_at, fired_at, finished_at, last_seen_at';

type SessionHandoffDbRow = {
  id: string;
  advisor_id: string | null;
  conversation_id: string | null;
  advisor_chat_id: string | null;
  request: string;
  asked: string | null;
  summary: string | null;
  refs: HandoffRef[] | null;
  subject_ref: string | null;
  request_key: string;
  status: DashHandoff['status'];
  run_id: string | null;
  error: string | null;
  cost_micros: number | string | null;
  created_at: string;
  fired_at: string | null;
  finished_at: string | null;
  last_seen_at: string | null;
};

function toSessionHandoff(row: SessionHandoffDbRow): SessionHandoff {
  return {
    id: row.id,
    advisorId: row.advisor_id,
    conversationId: row.conversation_id,
    advisorChatId: row.advisor_chat_id,
    request: row.request,
    asked: row.asked ?? '',
    summary: row.summary,
    refs: Array.isArray(row.refs) ? row.refs : [],
    subjectRef: row.subject_ref,
    requestKey: row.request_key,
    state: handoffState(row.status),
    runId: row.run_id,
    error: row.error,
    costMicros: row.cost_micros === null ? null : Number(row.cost_micros),
    createdAt: row.created_at,
    firedAt: row.fired_at,
    finishedAt: row.finished_at,
    lastSeenAt: row.last_seen_at,
  };
}

/** The stored status a state was read from (handoffState, the other way). */
const STATUS_OF: Record<HandoffState, DashHandoff['status']> = { queued: 'pending', running: 'fired', done: 'done', failed: 'failed' };

/** The stored status of a state, as Ask's own hand-offs carry it. */
export function handoffStatusOf(state: HandoffState): DashHandoff['status'] {
  return STATUS_OF[state];
}

/**
 * An Ask Dash session hand-off as Ask's own hand-offs read (plan #3005.2):
 * the answer ties it to its turn, starts it and lists it as it always has.
 */
export function askHandoffOf(handoff: SessionHandoff): DashHandoff {
  return {
    id: handoff.id,
    conversationId: handoff.conversationId ?? '',
    turnId: null,
    request: handoff.request,
    subjectRef: handoff.subjectRef,
    status: STATUS_OF[handoff.state],
    runId: handoff.runId,
    error: handoff.error,
    createdAt: handoff.createdAt,
  };
}

/** The session hand-off kept under one request key, or null. */
export async function loadSessionHandoffByKey(
  core: CoreSupabaseClient,
  userId: string,
  requestKey: string,
): Promise<SessionHandoff | null> {
  const { data, error } = await core
    .from('dash_handoffs')
    .select(SESSION_SELECT)
    .eq('user_id', userId)
    .eq('request_key', requestKey)
    .maybeSingle();
  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Reading the hand-off failed: ${error.message}`);
  return data ? toSessionHandoff(data as SessionHandoffDbRow) : null;
}

/**
 * Keeps a request a bot hands to a Claude Code session, once per request
 * (plan #3005.1). A retried turn sends the same key: the insert is skipped
 * on the unique (user_id, request_key) and the row already kept comes back
 * with `created: false`, so the caller starts no second session.
 */
export async function keepSessionHandoff(
  core: CoreSupabaseClient,
  userId: string,
  input: SessionHandoffInput,
): Promise<{ ok: true; handoff: SessionHandoff; created: boolean } | { ok: false; error: string }> {
  const built = sessionHandoffRow(userId, input);
  if (!built.ok) return built;
  const { data, error } = await core
    .from('dash_handoffs')
    .upsert(built.row, { onConflict: 'user_id,request_key', ignoreDuplicates: true })
    .select(SESSION_SELECT);
  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Keeping the hand-off failed: ${error.message}`);
  const inserted = ((data ?? []) as SessionHandoffDbRow[])[0];
  if (inserted) return { ok: true, handoff: toSessionHandoff(inserted), created: true };
  const kept = await loadSessionHandoffByKey(core, userId, built.row.request_key);
  if (!kept) throw new Error('Keeping the hand-off failed: the row under its key was not found.');
  return { ok: true, handoff: kept, created: false };
}

/** The session hand-offs asked in one thread, newest first, for "how's it going?". */
export async function loadThreadSessionHandoffs(
  core: CoreSupabaseClient,
  userId: string,
  thread: HandoffThread,
  limit = 10,
): Promise<SessionHandoff[]> {
  let query = core.from('dash_handoffs').select(SESSION_SELECT).eq('user_id', userId).eq('kind', 'session');
  query =
    thread.kind === 'ask'
      ? query.eq('conversation_id', thread.conversationId)
      : query.eq('advisor_chat_id', thread.chatId);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Reading the hand-offs failed: ${error.message}`);
  return ((data ?? []) as SessionHandoffDbRow[]).map(toSessionHandoff);
}

/** The same, through the signed-in person's own client, for a page to call. */
export async function workingRefsForPage(userId: string): Promise<string[]> {
  try {
    return await loadWorkingRefs(await createCoreClient(), userId);
  } catch (error) {
    console.error('the open hand-offs were not read', error);
    return [];
  }
}

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommentAuthor, DevComment } from '@/lib/comments/load';
import type { DashChange } from '@/lib/talk/changes';

/**
 * Reading and writing the thread under any row, in core.conversations
 * (docs/CORE-AND-DASH-SPEC.md, Part 2; plan #1470).
 *
 * Every thread is a `row` conversation keyed by the ref of the row it sits
 * under, `schema.table:id`. Its turns are read through the core.thread_turns
 * view, which spells the author as the old thread tables did ('me' for the
 * person, 'claude' for Dash), and written with core.add_thread_turn, which
 * starts the thread when there is none (migration 0167). The tables threads
 * used to live in (dev_comments, goals.comments, core.file_comments and a
 * role's notes) are read-only now.
 *
 * Any client will do, whatever schema it was made for: the calls go through
 * `.schema('core')`. On the person's session RLS keeps them to their own
 * threads. A service-role client sees every account's, so pass `userId` to
 * the reads made with one.
 *
 * Kept free of server-only imports so the loaders' tests can stub a client.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyClient = SupabaseClient<any, any, any>;

/** What a write says when the row is not the writer's, or is gone. */
export const THREAD_ROW_NOT_YOURS = 'That row is not one of yours, or it is no longer there.';

/** The columns a thread is read with: core.thread_turns. */
const TURN_COLUMNS = 'id, ref, author, body, created_at, acknowledged_at';

/** Refs per request; a longer list would overflow the URL. */
const REFS_PER_READ = 100;

type TurnRow = {
  id: string;
  ref: string;
  author: string;
  body: string;
  created_at: string;
  acknowledged_at?: string | null;
};

function toComment(row: TurnRow): DevComment {
  return {
    id: row.id,
    author: row.author === 'claude' ? 'claude' : 'me',
    body: row.body,
    createdAt: String(row.created_at ?? ''),
    acknowledgedAt: row.acknowledged_at ? String(row.acknowledged_at) : null,
  };
}

function group(rows: readonly TurnRow[]): Map<string, DevComment[]> {
  const byRef = new Map<string, DevComment[]>();
  for (const row of rows) {
    const list = byRef.get(row.ref) ?? [];
    list.push(toComment(row));
    byRef.set(row.ref, list);
  }
  for (const list of byRef.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return byRef;
}

/** The ref a thread under this row is keyed by: `schema.table:id`. */
export function rowRef(table: string, id: string): string {
  return `${table}:${id}`;
}

/**
 * The threads under the given rows, oldest turn first, keyed by ref. A row
 * with no thread is absent from the map.
 */
export async function loadThreads(
  client: AnyClient,
  refs: readonly string[],
  options: { userId?: string } = {},
): Promise<Map<string, DevComment[]>> {
  const unique = [...new Set(refs)];
  if (unique.length === 0) return new Map();
  const chunks: string[][] = [];
  for (let at = 0; at < unique.length; at += REFS_PER_READ) chunks.push(unique.slice(at, at + REFS_PER_READ));
  const rows = await Promise.all(
    chunks.map(async (chunk) => {
      let query = client.schema('core').from('thread_turns').select(TURN_COLUMNS).in('ref', chunk);
      if (options.userId) query = query.eq('user_id', options.userId);
      const { data, error } = await query;
      if (error) throw new Error(`Reading the threads failed: ${error.message}`);
      return (data ?? []) as TurnRow[];
    }),
  );
  return withPaid(client, group(rows.flat()), options);
}

/** What core.dash_actions holds of a queued paid press, as read for a thread's card. */
const PAID_COLUMNS =
  'id, conversation_id, turn_id, kind, input, status, subject_ref, undo, created_at, done_at, declined_at, undone_at, summary';

type PaidRow = {
  id: string;
  conversation_id: string;
  turn_id: string | null;
  kind: string;
  input: Record<string, unknown>;
  status: string;
  subject_ref: string | null;
  undo: Record<string, unknown> | null;
  created_at: string;
  done_at: string | null;
  declined_at: string | null;
  undone_at: string | null;
  summary?: string | null;
};

function toPaid(row: PaidRow): DashChange {
  const colon = row.subject_ref?.lastIndexOf(':') ?? -1;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    turnId: row.turn_id,
    kind: 'paid_action',
    input: row.input,
    status: row.status,
    subjectRef: row.subject_ref,
    writtenTable: row.subject_ref && colon > 0 ? row.subject_ref.slice(0, colon) : null,
    writtenRef: row.subject_ref && colon > 0 ? row.subject_ref.slice(colon + 1) : null,
    undo: row.undo,
    createdAt: row.created_at,
    doneAt: row.done_at,
    declinedAt: row.declined_at,
    undoneAt: row.undone_at,
    summary: row.summary ?? null,
  } as DashChange;
}

/**
 * The paid presses Dash queued from a comment (plan #2228.1), set on that
 * comment as `paid` so the thread can draw their approval card (plan
 * #2228.2). Only the person's own comments carry them. A read that fails
 * leaves the thread without cards rather than failing the page.
 */
async function withPaid(
  client: AnyClient,
  byRef: Map<string, DevComment[]>,
  options: { userId?: string },
): Promise<Map<string, DevComment[]>> {
  const mine = [...byRef.values()].flat().filter((comment) => comment.author === 'me');
  if (mine.length === 0) return byRef;
  const ids = mine.map((comment) => comment.id);
  try {
    const chunks: string[][] = [];
    for (let at = 0; at < ids.length; at += REFS_PER_READ) chunks.push(ids.slice(at, at + REFS_PER_READ));
    const rows = await Promise.all(
      chunks.map(async (chunk) => {
        let query = client
          .schema('core')
          .from('dash_actions')
          .select(PAID_COLUMNS)
          .eq('surface', 'thread')
          .eq('kind', 'paid_action')
          .in('turn_id', chunk);
        if (options.userId) query = query.eq('user_id', options.userId);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return (data ?? []) as PaidRow[];
      }),
    );
    const byTurn = new Map<string, DashChange[]>();
    for (const row of rows.flat()) {
      if (row.kind !== 'paid_action' || !row.turn_id || !row.input) continue;
      byTurn.set(row.turn_id, [...(byTurn.get(row.turn_id) ?? []), toPaid(row)]);
    }
    if (byTurn.size === 0) return byRef;
    for (const list of byTurn.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const comment of mine) {
      const paid = byTurn.get(comment.id);
      if (paid) comment.paid = paid;
    }
  } catch (error) {
    console.error('Reading the paid presses under the threads failed', error);
  }
  return byRef;
}

/**
 * Every thread under rows of one table, keyed by ref: for a page that lists
 * the whole table, such as the plan, where naming each row would mean
 * hundreds of refs.
 */
export async function loadTableThreads(
  client: AnyClient,
  table: string,
  options: { userId?: string } = {},
): Promise<Map<string, DevComment[]>> {
  let query = client.schema('core').from('thread_turns').select(TURN_COLUMNS).like('ref', `${table}:%`);
  if (options.userId) query = query.eq('user_id', options.userId);
  const { data, error } = await query;
  if (error) throw new Error(`Reading the threads failed: ${error.message}`);
  return withPaid(client, group((data ?? []) as TurnRow[]), options);
}

/** The thread under one row, oldest first; empty when there is none. */
export async function loadThread(
  client: AnyClient,
  ref: string,
  options: { userId?: string } = {},
): Promise<DevComment[]> {
  return (await loadThreads(client, [ref], options)).get(ref) ?? [];
}

/**
 * Adds one turn to the thread under a row, starting the thread when there is
 * none, and returns the turn's id. Throws THREAD_ROW_NOT_YOURS when the row is
 * not the account's or has been deleted.
 */
export async function addThreadTurn(
  client: AnyClient,
  input: { userId: string; ref: string; author: CommentAuthor; body: string },
): Promise<string> {
  const { data, error } = await client.schema('core').rpc('add_thread_turn', {
    p_user_id: input.userId,
    p_ref: input.ref,
    p_author: input.author,
    p_body: input.body,
  });
  if (error && /is not a row of yours|no thread under/.test(error.message)) throw new Error(THREAD_ROW_NOT_YOURS);
  if (error) throw new Error(`Keeping that failed: ${error.message}`);
  if (typeof data !== 'string') throw new Error('Keeping that failed: no id came back.');
  return data;
}

/**
 * Marks one of the person's comments as seen by Dash, which chose not to reply
 * (plan #1648), and returns when. Marking an already marked comment keeps the
 * first time. Throws THREAD_ROW_NOT_YOURS when the comment is not the
 * account's, is not under that row, or was written by Dash.
 */
export async function acknowledgeThreadTurn(
  client: AnyClient,
  input: { userId: string; ref: string; turnId: string },
): Promise<string> {
  const { data, error } = await client.schema('core').rpc('acknowledge_thread_turn', {
    p_user_id: input.userId,
    p_ref: input.ref,
    p_turn: input.turnId,
  });
  if (error && /not a comment of yours/.test(error.message)) throw new Error(THREAD_ROW_NOT_YOURS);
  if (error) throw new Error(`Marking that seen failed: ${error.message}`);
  if (typeof data !== 'string') throw new Error('Marking that seen failed: no time came back.');
  return data;
}

/**
 * The comment a Dash reply answers, as the cause its writes are recorded
 * under in core.dash_actions (plan #1518): the turn and the row thread it sits
 * in. Null when the turn is not the account's or is gone, and then the writes
 * are recorded with no comment rather than not at all.
 */
export async function threadCause(
  client: AnyClient,
  input: { userId: string; turnId: string },
): Promise<{ conversationId: string; turnId: string } | null> {
  const { data, error } = await client
    .schema('core')
    .from('conversation_turns')
    .select('id, conversation_id')
    .eq('id', input.turnId)
    .eq('user_id', input.userId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { id: string; conversation_id: string | null };
  return row.conversation_id ? { conversationId: row.conversation_id, turnId: row.id } : null;
}

/**
 * Takes one turn out of a thread and returns the ref of the row the thread
 * sits under, so the caller can redraw its page; null when there was no such
 * turn of the account's.
 */
export async function removeThreadTurn(
  client: AnyClient,
  input: { id: string; userId?: string },
): Promise<string | null> {
  const core = client.schema('core');
  let find = core.from('thread_turns').select('ref').eq('id', input.id);
  if (input.userId) find = find.eq('user_id', input.userId);
  const { data: found, error: findError } = await find.maybeSingle();
  if (findError) throw new Error(`Reading that comment failed: ${findError.message}`);
  if (!found) return null;

  let remove = core.from('conversation_turns').delete().eq('id', input.id);
  if (input.userId) remove = remove.eq('user_id', input.userId);
  const { data, error } = await remove.select('id');
  if (error) throw new Error(`Deleting that comment failed: ${error.message}`);
  return (data ?? []).length > 0 ? (found as { ref: string }).ref : null;
}

/** Past this many rows a page's threads are read by table rather than by ref. */
const BY_TABLE_PAST = 300;

/**
 * The threads under the given rows of one table, keyed by ref: by ref for a
 * short list, by table past BY_TABLE_PAST rows.
 */
export async function loadRowThreads(
  client: AnyClient,
  table: string,
  ids: readonly string[],
  options: { userId?: string } = {},
): Promise<Map<string, DevComment[]>> {
  if (ids.length === 0) return new Map();
  if (ids.length > BY_TABLE_PAST) return loadTableThreads(client, table, options);
  return loadThreads(
    client,
    ids.map((id) => rowRef(table, id)),
    options,
  );
}

/**
 * The rows given, each with `thread` set to the turns of the thread under it:
 * for a loader that used to embed the thread in its select, so the mapping
 * that reads `row.thread` stays as it was. Rows without an id are passed on
 * untouched.
 */
export async function withThreads<T extends Record<string, unknown>>(
  client: AnyClient,
  table: string,
  rows: readonly T[],
  options: { userId?: string } = {},
): Promise<(T & { thread: DevComment[] })[]> {
  const ids = rows.map((row) => row.id).filter((id): id is string => typeof id === 'string');
  const threads = await loadRowThreads(client, table, ids, options);
  return rows.map((row) => ({
    ...row,
    thread: typeof row.id === 'string' ? (threads.get(rowRef(table, row.id)) ?? []) : [],
  }));
}

/**
 * The SQL a routine writes its reply into a thread with, for the prompts that
 * hand it one: Dash's turn under the row's ref, through core.add_thread_turn.
 */
export function threadReplySql(userId: string, ref: string, placeholder: string): string {
  return `select core.add_thread_turn('${userId}', '${ref}', 'claude', '${placeholder}');`;
}

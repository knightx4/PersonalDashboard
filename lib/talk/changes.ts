import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { CORE_SCHEMA, type CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { parseRef } from '@/lib/core/refs';

/**
 * The changes Dash proposes in an Ask Dash answer (feature #1186), kept in
 * core.dash_actions with surface 'ask' (core migrations 0125 and 0161; the
 * table was core.dash_changes until plan #1457 made it the record of every
 * change Dash makes). A proposal is only a row here until the person confirms
 * it; nothing else is written when Dash proposes.
 *
 * Plan #1188 writes proposals and ties them to the answer that made them.
 * Confirming, declining and undoing (#1189), the cards (#1190) and the list on
 * the Ask page (#1191) read and move the same rows. The table's trigger allows
 * only proposed -> done, proposed -> declined and done -> undone, and keeps
 * kind, input and conversation fixed once written.
 *
 * Every reader here keeps to surface 'ask': the kinds and inputs typed below
 * are Ask's, and other surfaces write kinds of their own.
 */

/** The table, in the core schema. */
export const DASH_ACTIONS = 'dash_actions';

export const DASH_CHANGE_KINDS = [
  'add_todo',
  'add_goal_step',
  'mark_returned',
  'start_watch',
  'add_goal',
  'change_todo',
  'close_todo',
  'close_goal_step',
  'add_role_note',
] as const;
export type DashChangeKind = (typeof DASH_CHANGE_KINDS)[number];

export type DashChangeStatus = 'proposed' | 'done' | 'declined' | 'undone';

/**
 * What each kind stores in `input`: the arguments its writer takes, plus the
 * title of the thing it hangs from so a card can say what it is about
 * without another read.
 *
 * add_todo       createTask(userId, input, timezone) takes it as a TaskInput.
 * add_goal_step  insertStep(client, userId, parentId, { title, kind }).
 * mark_returned  markItemReturned's form field `id`.
 * start_watch    the core.watches row to insert (plan #1296): `below` and
 *                `currency` become its condition, `endsAt` is an instant.
 *                `goalTitle` names the goal or step it serves, and `pushOn`
 *                says whether any device had push switched on when Dash
 *                proposed it, so the card can say nothing will reach them.
 *
 * The five kinds below were added when Ask started making changes straight
 * away (plan #1440). Each is written by its tool in lib/dash/writes.ts and
 * kept as done from the start; `input` holds only what the card says.
 *
 * add_goal         the goal and the area it went under.
 * change_todo      the todo's title now, the title it had when renamed, and
 *                  the day it moved to when moved (null: no day any more).
 * close_todo       the todo ticked off.
 * close_goal_step  the step marked done and the goal it sits under.
 * add_role_note    the note and the role it went on.
 */
export type DashChangeInput = {
  add_todo: { title: string; body: null; dueOn: string | null; dueTime: null; pinned: false };
  add_goal_step: { parentId: string; goalTitle: string; title: string; kind: 'mine' };
  mark_returned: { id: string; itemTitle: string };
  start_watch: {
    title: string;
    url: string;
    below: number | null;
    currency: string | null;
    reportTimes: string[];
    endsAt: string;
    /** The day it ends, YYYY-MM-DD in the person's zone, for the card. */
    endsOn: string;
    goalItemId: string | null;
    goalTitle: string | null;
    pushOn: boolean;
  };
  add_goal: { areaId: string; areaName: string; title: string; dueOn: string | null };
  change_todo: {
    id: string;
    title: string;
    renamedFrom: string | null;
    moved: boolean;
    dueOn: string | null;
    dueTime: string | null;
  };
  close_todo: { id: string; title: string; items: number };
  close_goal_step: { id: string; title: string; goalId: string; goalTitle: string };
  add_role_note: { roleId: string; roleTitle: string; body: string };
};

/** The kinds Dash proposed for a Confirm before plan #1440, which keep their own undo in lib/ask/changes.ts. */
export const PROPOSAL_KINDS: readonly DashChangeKind[] = ['add_todo', 'add_goal_step', 'mark_returned', 'start_watch'];

/** A proposal as the loop hands it to be kept, or a change Dash has just made. */
export type NewDashChange = {
  [K in DashChangeKind]: { kind: K; input: DashChangeInput[K] };
}[DashChangeKind];

export type DashChange = NewDashChange & {
  id: string;
  conversationId: string;
  /** Dash's turn that proposed it; null only while that answer is being written. */
  turnId: string | null;
  status: DashChangeStatus;
  /** The row the confirm wrote or changed, as a ref (`schema.table:id`); null until then. */
  subjectRef: string | null;
  /** That ref's table and id, split out for the card's link and the undo. */
  writtenTable: string | null;
  writtenRef: string | null;
  undo: Record<string, unknown> | null;
  createdAt: string;
  /** When the change was written: the confirm. */
  doneAt: string | null;
  declinedAt: string | null;
  undoneAt: string | null;
};

type DashChangeRow = {
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
};

export const DASH_CHANGE_SELECT =
  'id, conversation_id, turn_id, kind, input, status, subject_ref, undo, created_at, done_at, declined_at, undone_at';

export function toDashChange(row: DashChangeRow): DashChange {
  const subject = row.subject_ref ? parseRef(row.subject_ref) : null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    turnId: row.turn_id,
    kind: row.kind,
    input: row.input,
    status: row.status as DashChangeStatus,
    subjectRef: row.subject_ref,
    writtenTable: subject?.table ?? null,
    writtenRef: subject?.id ?? null,
    undo: row.undo,
    createdAt: row.created_at,
    doneAt: row.done_at,
    declinedAt: row.declined_at,
    undoneAt: row.undone_at,
  } as DashChange;
}

/** Keeps one proposal in an `ask` conversation, whose id is its ref. */
export async function insertProposal(
  core: CoreSupabaseClient,
  userId: string,
  conversationId: string,
  change: NewDashChange,
): Promise<DashChange> {
  const { data, error } = await core
    .from(DASH_ACTIONS)
    .insert({ user_id: userId, conversation_id: conversationId, surface: 'ask', kind: change.kind, input: change.input })
    .select(DASH_CHANGE_SELECT)
    .single();
  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Keeping the proposal failed: ${error.message}`);
  return toDashChange(data as DashChangeRow);
}

/** A change Dash has just made from Ask, as lib/dash/writes.ts reports it. */
export type MadeDashChange = NewDashChange & {
  subjectRef: string;
  op: 'insert' | 'update' | 'delete';
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  summary: string;
  undo: Record<string, unknown> | null;
};

/**
 * Keeps a change Dash made straight away (plan #1440) in an `ask`
 * conversation: done from the start, with the row it wrote and that row's
 * values before and after, so its card under the answer offers Undo. Tied to
 * the answer by attachProposals once the answer is kept, like a proposal.
 */
export async function insertMadeChange(
  core: CoreSupabaseClient,
  userId: string,
  conversationId: string,
  made: MadeDashChange,
  now: string = new Date().toISOString(),
): Promise<DashChange> {
  const { data, error } = await core
    .from(DASH_ACTIONS)
    .insert({
      user_id: userId,
      conversation_id: conversationId,
      surface: 'ask',
      kind: made.kind,
      input: made.input,
      status: 'done',
      done_at: now,
      subject_ref: made.subjectRef,
      op: made.op,
      before_values: made.op === 'insert' ? null : made.before,
      after_values: made.op === 'delete' ? null : made.after,
      summary: made.summary.replace(/\s+/g, ' ').trim().slice(0, 300),
      undo: made.undo,
    })
    .select(DASH_CHANGE_SELECT)
    .single();
  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Keeping the change failed: ${error.message}`);
  return toDashChange(data as DashChangeRow);
}

/**
 * Ties proposals to the answer that made them, once that turn is written.
 * The table allows this once per row, so only rows with no turn yet are
 * touched.
 */
export async function attachProposals(
  core: CoreSupabaseClient,
  ids: readonly string[],
  turnId: string,
): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await core
    .from(DASH_ACTIONS)
    .update({ turn_id: turnId })
    .in('id', [...ids])
    .is('turn_id', null);
  if (error) throw new Error(`Tying the proposals to the answer failed: ${error.message}`);
}

/**
 * Removes proposals whose answer was never kept, so no card is left without
 * the answer it belonged to. Only untouched proposals go.
 */
export async function discardProposals(core: CoreSupabaseClient, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await core
    .from(DASH_ACTIONS)
    .delete()
    .in('id', [...ids])
    .eq('status', 'proposed')
    .is('turn_id', null);
  if (error) throw new Error(`Removing the proposals failed: ${error.message}`);
}

/** Every change proposed in one conversation, in the order proposed. */
export async function loadChanges(core: CoreSupabaseClient, conversationId: string): Promise<DashChange[]> {
  const { data, error } = await core
    .from(DASH_ACTIONS)
    .select(DASH_CHANGE_SELECT)
    .eq('conversation_id', conversationId)
    .eq('surface', 'ask')
    .order('created_at', { ascending: true });
  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Reading the proposed changes failed: ${error.message}`);
  return ((data ?? []) as DashChangeRow[]).map(toDashChange);
}

/** A written change as the Ask page lists it: the change and the question it came from. */
export type MadeChange = DashChange & {
  /** The question the change was proposed under; null when it had no title. */
  question: string | null;
};

/**
 * The changes the person confirmed through Dash, still standing or taken
 * back, newest first (plan #1191). Proposals never confirmed and declined
 * ones are left out: nothing was written for them. RLS keeps it to the
 * signed-in person's rows; the (user_id, created_at desc) index serves it.
 */
export async function loadMadeChanges(core: CoreSupabaseClient, limit = 200): Promise<MadeChange[]> {
  const { data, error } = await core
    .from(DASH_ACTIONS)
    .select(DASH_CHANGE_SELECT)
    .eq('surface', 'ask')
    .in('status', ['done', 'undone'])
    .order('created_at', { ascending: false })
    .limit(limit);
  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Reading the changes Dash made failed: ${error.message}`);
  const changes = ((data ?? []) as DashChangeRow[]).map(toDashChange);
  if (changes.length === 0) return [];

  const ids = [...new Set(changes.map((change) => change.conversationId))];
  const { data: conversations, error: titleError } = await core
    .from('conversations')
    .select('id, title')
    .in('id', ids);
  if (titleError) throw new Error(`Reading the questions behind the changes failed: ${titleError.message}`);
  const titles = new Map(
    ((conversations ?? []) as { id: string; title: string | null }[]).map((row) => [row.id, row.title]),
  );
  return changes.map((change) => ({ ...change, question: titles.get(change.conversationId) ?? null }));
}

import type { AskDb, AskSchema, SchemaClient } from '@/lib/ask/db';
import { parseRef } from '@/lib/core/refs';

/**
 * Undoing any change Dash made, by one rule (plan #1458, feature #1456;
 * docs/CORE-AND-DASH-SPEC.md, Part 5).
 *
 * Every change Dash makes is a row in core.dash_actions naming the row it
 * touched (`subject_ref`), what happened to it (`op`) and the row's values
 * before and after. Undo puts the before values back, but only while the row
 * still holds the after values. Once anything has changed it since, whether
 * the person, a page or a later run, the undo is refused with a sentence
 * saying why, so it never throws away later work. goals.history's Undo
 * (lib/goals/run-changes.ts) works the same way.
 *
 *   insert  the row Dash added is deleted.
 *   update  the columns Dash changed get their before values back.
 *   delete  the row Dash removed is inserted again as it was.
 *
 * The undo itself is not a new action: the action is marked `undone`, which
 * the table's guard allows only from `done`, so a second press finds nothing
 * to move.
 *
 * Everything else that writes for Dash records its change with
 * recordDashAction, alongside the write: the role thread's cover letter, the
 * dev comment actions and goal comment filing (plan #1459). Routines, which
 * write through the Supabase connector, call core.record_dash_action
 * (migration 0163, plan #1460), which writes the same row.
 *
 * Ask Dash's own changes keep their per-kind undo in lib/ask/changes.ts,
 * because some of them touch two rows (a return writes the item and a
 * returns row) and the generic rule sees only one. undoDashAction refuses
 * them and says where they are undone. Capture's filings (plan #1569) are the
 * same: one line can add a step and the progress on it, so capture's own
 * Undo puts the line back and marks the record undone.
 *
 * No `server-only` and no clients made here: callers hand in the person's
 * clients (requestAskDb() in a request), and the tests hand in stubs. Every
 * read and write goes through those clients, so row level security keeps an
 * undo to the person's own rows.
 */

/** The table, in the core schema. */
export const DASH_ACTIONS_TABLE = 'dash_actions';

export type DashActionSurface = 'ask' | 'thread' | 'capture' | 'scheduled' | 'routine';
export type DashActionStatus = 'proposed' | 'done' | 'declined' | 'undone';
export type DashActionOp = 'insert' | 'update' | 'delete';

type Values = Record<string, unknown>;

/** One row of core.dash_actions, whatever surface wrote it. */
export type DashAction = {
  id: string;
  surface: DashActionSurface;
  kind: string;
  status: DashActionStatus;
  subjectRef: string | null;
  op: DashActionOp | null;
  beforeValues: Values | null;
  afterValues: Values | null;
  summary: string | null;
  /** What undoing needs beyond the row: for a capture, { capture_id }. */
  undo: Values | null;
  createdAt: string;
  doneAt: string | null;
  undoneAt: string | null;
};

export const DASH_ACTION_SELECT =
  'id, surface, kind, status, subject_ref, op, before_values, after_values, summary, undo, created_at, done_at, undone_at';

type DashActionRow = {
  id: string;
  surface: string;
  kind: string;
  status: string;
  subject_ref: string | null;
  op: string | null;
  before_values: Values | null;
  after_values: Values | null;
  summary: string | null;
  undo?: Values | null;
  created_at: string;
  done_at: string | null;
  undone_at: string | null;
};

export function toDashAction(row: DashActionRow): DashAction {
  return {
    id: row.id,
    surface: row.surface as DashActionSurface,
    kind: row.kind,
    status: row.status as DashActionStatus,
    subjectRef: row.subject_ref,
    op: row.op as DashActionOp | null,
    beforeValues: row.before_values,
    afterValues: row.after_values,
    summary: row.summary,
    undo: row.undo ?? null,
    createdAt: row.created_at,
    doneAt: row.done_at,
    undoneAt: row.undone_at,
  };
}

export type DashActionDeps = {
  userId: string;
  /** The person's core client, for core.dash_actions. */
  core: SchemaClient;
  /** The person's client per schema, for the row the action touched. */
  db: AskDb;
  /** Now, as an ISO timestamp. */
  now?: () => string;
};

export type DashActionUndo =
  | { ok: true; action: DashAction }
  | { ok: false; error: string; action: DashAction | null };

/** The schemas a subject can live in: the ones the person has a client for. */
const SCHEMAS: ReadonlySet<string> = new Set<AskSchema>([
  'public',
  'core',
  'job_search',
  'obsidian',
  'todo',
  'learn',
  'news',
  'goals',
]);

/**
 * Columns left out of both the check and the restore: the row's identity,
 * which an undo never rewrites, and updated_at, which a trigger moves on any
 * write, including a reorder that changes nothing the person sees.
 */
const MANAGED = new Set(['id', 'user_id', 'created_at', 'updated_at']);

const GONE = 'That change is not there any more.';

/**
 * Why a change has no Undo, when its writer said so (plan #1571). Some writes
 * cannot sensibly be put back by restoring one row: a payment's amount is
 * worked out from every charge filed on it, and a charge moved between
 * payments touches three rows. The writer records the change anyway, so Home
 * lists it, with the sentence saying why in `undo.none`; Home shows that
 * sentence in place of the button, and an undo is refused with it.
 */
export function noUndoReason(action: Pick<DashAction, 'undo'>): string | null {
  const none = action.undo?.none;
  return typeof none === 'string' && none.trim() !== '' ? none.trim() : null;
}

/**
 * The rows that can hang off a row Dash added, by the table it added it to.
 * Undoing an add deletes the row, and the database would take these with it
 * (or blank the link to it), so an add that has gained any is not undone:
 * the comment, sub-step or idea written on it since is later work too.
 * Rows a trigger derives from the row itself, such as a record's readings,
 * are not listed, since they go with it rightly.
 */
/** From an order to its inventory items, by way of its order items. */
const ORDER_INVENTORY: Dependent['through'] = [
  { schema: 'public', table: 'order_items', column: 'order_id' },
  { schema: 'public', table: 'inventory_items', column: 'order_item_id' },
];

type Dependent = {
  schema: AskSchema;
  table: string;
  column: string;
  /**
   * Rows reached by way of others: each hop reads the ids of `table` whose
   * `column` holds the ids so far, starting from the subject's. For a row
   * whose children hang off its own children, such as an order's inventory
   * items, which hang off its order items.
   */
  through?: { schema: AskSchema; table: string; column: string }[];
  /**
   * Only rows created after the change was recorded count. For a child the
   * same run writes alongside the row, such as the event the mail sync files
   * on the application it has just made: that one goes with it, and one a
   * later email files is later work. The run records its change after the
   * last of its own writes, so its rows are always older than the record.
   */
  since?: true;
};

/** Each dependent, reached from the subject by way of `hop` first. */
function under(hop: { schema: AskSchema; table: string; column: string }, dependents: Dependent[]): Dependent[] {
  return dependents.map((dependent) => ({ ...dependent, through: [hop, ...(dependent.through ?? [])] }));
}

const JOB = 'job_search' as const;

/** What hangs off an interview: the person's notes, files and tasks, and who is on it. */
const INTERVIEW_DEPENDENTS: Dependent[] = [
  ...(['notes', 'attachments'] as const).map((table) => ({ schema: JOB, table, column: 'interview_id' })),
  { schema: 'todo', table: 'task_links', column: 'interview_id' },
  { schema: JOB, table: 'interview_participants', column: 'interview_id', since: true },
];

/** What hangs off a round of interviews. */
const INTERVIEW_GROUP_DEPENDENTS: Dependent[] = [
  { schema: JOB, table: 'interviews', column: 'group_id', since: true },
  { schema: JOB, table: 'interview_group_messages', column: 'group_id' },
  ...under({ schema: JOB, table: 'interviews', column: 'group_id' }, INTERVIEW_DEPENDENTS),
];

/**
 * What hangs off an application. The events, rounds and interviews the mail
 * sync writes with it count only when they came later; the rest are only
 * ever the person's or a later run's.
 */
const APPLICATION_DEPENDENTS: Dependent[] = [
  ...(['application_events', 'interview_groups', 'interviews'] as const).map((table) => ({
    schema: JOB,
    table,
    column: 'application_id',
    since: true as const,
  })),
  ...(
    [
      'notes',
      'attachments',
      'cover_letters',
      'application_answers',
      'reminders',
      'message_link_dismissals',
      'quiet_dismissals',
    ] as const
  ).map((table) => ({ schema: JOB, table, column: 'application_id' })),
  { schema: 'todo', table: 'task_links', column: 'application_id' },
  ...under({ schema: JOB, table: 'application_events', column: 'application_id' }, [
    { schema: JOB, table: 'waiting_dismissals', column: 'application_event_id' },
  ]),
  ...under({ schema: JOB, table: 'interview_groups', column: 'application_id' }, [
    { schema: JOB, table: 'interview_group_messages', column: 'group_id' },
  ]),
  ...under({ schema: JOB, table: 'interviews', column: 'application_id' }, INTERVIEW_DEPENDENTS),
];

/** What hangs off a role: a second application, and everything on its applications. */
const ROLE_DEPENDENTS: Dependent[] = [
  { schema: JOB, table: 'applications', column: 'role_id', since: true },
  ...(['notes', 'attachments'] as const).map((table) => ({ schema: JOB, table, column: 'role_id' })),
  { schema: 'todo', table: 'task_links', column: 'role_id' },
  ...under({ schema: JOB, table: 'applications', column: 'role_id' }, APPLICATION_DEPENDENTS),
];

const DEPENDENTS: Record<string, Dependent[]> = {
  'public.plan_items': [
    { schema: 'public', table: 'plan_items', column: 'parent_id' },
    { schema: 'public', table: 'dev_comments', column: 'plan_item_id' },
    { schema: 'public', table: 'plan_dependencies', column: 'item_id' },
    { schema: 'public', table: 'plan_dependencies', column: 'depends_on_id' },
    { schema: 'public', table: 'plan_runs', column: 'plan_item_id' },
    { schema: 'public', table: 'ideas', column: 'from_plan_item_id' },
    { schema: 'public', table: 'ideas', column: 'plan_item_id' },
    { schema: 'public', table: 'spec_changes', column: 'plan_item_id' },
  ],
  'public.ideas': [
    { schema: 'public', table: 'dev_comments', column: 'idea_id' },
    { schema: 'public', table: 'inspiration_takeaways', column: 'idea_id' },
  ],
  'public.feedback_items': [{ schema: 'public', table: 'dev_comments', column: 'feedback_item_id' }],
  // What routines add through core.record_dash_action (plan #1460).
  'goals.items': [
    { schema: 'goals', table: 'items', column: 'parent_id' },
    { schema: 'goals', table: 'comments', column: 'item_id' },
    { schema: 'goals', table: 'answers', column: 'item_id' },
    { schema: 'goals', table: 'dependencies', column: 'item_id' },
    { schema: 'goals', table: 'dependencies', column: 'depends_on_id' },
    { schema: 'goals', table: 'links', column: 'item_id' },
    { schema: 'goals', table: 'progress_entries', column: 'item_id' },
    { schema: 'todo', table: 'task_links', column: 'goal_id' },
    { schema: 'learn', table: 'aims', column: 'goal_id' },
    { schema: 'public', table: 'raised_items', column: 'goal_id' },
  ],
  'goals.collections': [
    { schema: 'goals', table: 'records', column: 'collection_id' },
    { schema: 'goals', table: 'items', column: 'collection_id' },
    { schema: 'goals', table: 'collection_goals', column: 'collection_id' },
  ],
  'goals.records': [{ schema: 'goals', table: 'answers', column: 'changed_record_id' }],
  'core.files': [{ schema: 'core', table: 'file_comments', column: 'file_id' }],
  // What scheduled runs add (plan #1570): the job sweep's withdrawal events.
  'job_search.application_events': [
    { schema: 'job_search', table: 'waiting_dismissals', column: 'application_event_id' },
  ],
  // What the mail sync adds (plan #1571): a payment filed from a bill. Its
  // charges come from the same mail and go with it; a name the person
  // corrected onto it is their later work.
  'public.recurring_payments': [
    { schema: 'public', table: 'recurring_payee_aliases', column: 'payment_id' },
  ],
  'todo.tasks': [
    { schema: 'todo', table: 'tasks', column: 'parent_id' },
    { schema: 'todo', table: 'task_links', column: 'task_id' },
  ],
  // What the mail sync adds (plan #1576): an order imported from a
  // confirmation, with its items and the inventory items they made. Those and
  // the book or game details looked up for them go with it; a shipment or
  // return from later mail, a task, and a use, list or family the person put
  // an item in are later work.
  'public.orders': [
    { schema: 'public', table: 'shipments', column: 'order_id' },
    { schema: 'public', table: 'returns', column: 'order_id' },
    { schema: 'todo', table: 'task_links', column: 'order_id' },
    ...(['item_uses', 'inventory_item_lists', 'inventory_item_families'] as const).map((table) => ({
      schema: 'public' as const,
      table,
      column: 'inventory_item_id',
      through: ORDER_INVENTORY,
    })),
    { schema: 'todo', table: 'task_links', column: 'inventory_item_id', through: ORDER_INVENTORY },
  ],
  // What the mail sync files in the job search (plan #1575). A company or a
  // role it adds is one change with the application, events and interviews
  // the same email made; anything written on them since is later work.
  'job_search.companies': [
    { schema: JOB, table: 'roles', column: 'company_id', since: true },
    ...(['notes', 'attachments'] as const).map((table) => ({ schema: JOB, table, column: 'company_id' })),
    { schema: 'todo', table: 'task_links', column: 'company_id' },
    ...under({ schema: JOB, table: 'roles', column: 'company_id' }, ROLE_DEPENDENTS),
  ],
  'job_search.roles': ROLE_DEPENDENTS,
  'job_search.interview_groups': INTERVIEW_GROUP_DEPENDENTS,
  'job_search.contacts': [
    { schema: JOB, table: 'interview_participants', column: 'contact_id', since: true },
    ...(['notes', 'attachments', 'contact_touches', 'reminders', 'suggestions'] as const).map((table) => ({
      schema: JOB,
      table,
      column: 'contact_id',
    })),
    { schema: 'todo', table: 'task_links', column: 'contact_id' },
    { schema: JOB, table: 'applications', column: 'referral_contact_id' },
  ],
};

/** A refusal the person reads. */
class Refused extends Error {}

// ---------------------------------------------------------------------------
// The rule, pure
// ---------------------------------------------------------------------------

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/**
 * Whether two stored values are the same. Timestamps are compared as
 * instants, since the app and the connector write the same moment in
 * different forms (`…Z` and `…+00:00`).
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) {
    return (a ?? null) === (b ?? null);
  }
  if (typeof a === 'string' && typeof b === 'string') {
    if (ISO_TIME.test(a) && ISO_TIME.test(b)) {
      const ta = Date.parse(a);
      const tb = Date.parse(b);
      return !Number.isNaN(ta) && ta === tb;
    }
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => sameValue(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as Values);
    const kb = Object.keys(b as Values);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => sameValue((a as Values)[k], (b as Values)[k]));
  }
  return false;
}

/** The columns where the row no longer holds what Dash left in it. */
export function movedColumns(current: Values, after: Values): string[] {
  return Object.keys(after).filter((k) => !MANAGED.has(k) && !sameValue(current[k], after[k]));
}

/** What an undo will do to the row, once the rule allows it. */
export type UndoPlan =
  | { op: 'delete' }
  | { op: 'update'; values: Values }
  | { op: 'insert'; values: Values };

/** Why an action in this status cannot be undone. */
function notDone(status: DashActionStatus): string {
  switch (status) {
    case 'proposed':
      return 'Nothing has been written yet, so there is nothing to undo.';
    case 'declined':
      return 'This change was declined, so nothing was written.';
    case 'undone':
      return 'This change has already been undone.';
    default:
      return 'This change cannot be undone.';
  }
}

/**
 * Whether an action can be undone, given the row as it is now (null when it
 * is not there) and whether Dash has changed the same row again since. The
 * answer is what the undo will write, or the sentence the person reads.
 */
export function planUndo(
  action: DashAction,
  current: Values | null,
  /**
   * Whether Dash has changed the same row again since: true, or 'fixed' when
   * that later change is one with no Undo of its own.
   */
  laterAction: boolean | 'fixed',
): { ok: true; plan: UndoPlan } | { ok: false; reason: string } {
  if (action.status !== 'done') return { ok: false, reason: notDone(action.status) };
  const none = noUndoReason(action);
  if (none) return { ok: false, reason: none };
  if (action.surface === 'ask') {
    return { ok: false, reason: 'This change was made in Ask Dash, and is undone from there.' };
  }
  // A capture line can touch more than its one row (an added step and the
  // progress filed on it), so it is undone by capture's own rule
  // (lib/goals/capture-store.ts, undoFiledAction), which marks this undone.
  if (action.surface === 'capture') {
    return { ok: false, reason: 'This was filed from capture, and is undone from there.' };
  }
  const { op, beforeValues: before, afterValues: after } = action;
  const recorded =
    action.subjectRef !== null &&
    ((op === 'insert' && after !== null) ||
      (op === 'update' && after !== null && before !== null) ||
      (op === 'delete' && before !== null));
  if (!recorded) {
    return { ok: false, reason: 'Dash did not keep what this changed, so it cannot be undone.' };
  }
  if (laterAction === 'fixed') {
    return {
      ok: false,
      reason: 'Dash has changed this again since, in a way it cannot undo, so this cannot be undone either.',
    };
  }
  if (laterAction) {
    return { ok: false, reason: 'Dash has changed this again since. Undo that later change first.' };
  }

  if (op === 'delete') {
    if (current) return { ok: false, reason: 'It is back already, so there is nothing to undo.' };
    return { ok: true, plan: { op: 'insert', values: { ...before } } };
  }

  if (!current) return { ok: false, reason: 'It has since been deleted, so there is nothing to undo.' };
  if (movedColumns(current, after!).length > 0) {
    return {
      ok: false,
      reason: 'It has changed since Dash wrote it, so undoing would lose the later change.',
    };
  }
  if (op === 'insert') return { ok: true, plan: { op: 'delete' } };

  // Only what Dash changed goes back: a column it left alone keeps its value.
  const values = Object.fromEntries(
    Object.entries(before!).filter(([k, v]) => !MANAGED.has(k) && k in after! && !sameValue(v, after![k])),
  );
  return { ok: true, plan: { op: 'update', values } };
}

// ---------------------------------------------------------------------------
// Reading and writing the subject row
// ---------------------------------------------------------------------------

/** The client and table a ref points into, or null when it is not one Dash can reach. */
async function subjectTable(db: AskDb, ref: string): Promise<{ client: SchemaClient; table: string; id: string } | null> {
  const parsed = parseRef(ref);
  if (!parsed || !SCHEMAS.has(parsed.schema)) return null;
  return { client: await db(parsed.schema as AskSchema), table: parsed.name, id: parsed.id };
}

/**
 * The whole row a ref points at, as the person's client sees it, or null
 * when it is not there. What a writer records as before_values and
 * after_values.
 */
export async function readSubject(db: AskDb, ref: string): Promise<Values | null> {
  const subject = await subjectTable(db, ref);
  if (!subject) return null;
  const { data, error } = await subject.client
    .from(subject.table)
    .select('*')
    .eq('id', subject.id)
    .maybeSingle();
  if (error) throw new Error(`Reading ${ref} failed: ${error.message}`);
  return (data as Values | null) ?? null;
}

/** Whether anything has been written on the row since Dash added it. */
async function hasDependents(db: AskDb, ref: string, recordedAt: string): Promise<boolean> {
  const parsed = parseRef(ref);
  const dependents = parsed ? (DEPENDENTS[parsed.table] ?? []) : [];
  for (const { schema, table, column, through, since } of dependents) {
    let ids = [parsed!.id];
    for (const hop of through ?? []) {
      const { data, error } = await (await db(hop.schema)).from(hop.table).select('id').in(hop.column, ids);
      if (error) throw new Error(`Reading what hangs off ${ref} failed: ${error.message}`);
      ids = ((data ?? []) as { id: string }[]).map((row) => row.id);
      if (ids.length === 0) break;
    }
    if (ids.length === 0) continue;
    const client = await db(schema);
    const query = client.from(table).select('id');
    const narrowed = through ? query.in(column, ids) : query.eq(column, ids[0]);
    const { data, error } = await (since ? narrowed.gt('created_at', recordedAt) : narrowed).limit(1);
    if (error) throw new Error(`Reading what hangs off ${ref} failed: ${error.message}`);
    if ((data ?? []).length > 0) return true;
  }
  return false;
}

async function laterActionOn(deps: DashActionDeps, action: DashAction): Promise<boolean | 'fixed'> {
  const { data, error } = await deps.core
    .from(DASH_ACTIONS_TABLE)
    .select('id, undo')
    .eq('user_id', deps.userId)
    .eq('subject_ref', action.subjectRef)
    .eq('status', 'done')
    .gt('created_at', action.createdAt)
    .neq('id', action.id)
    .limit(20);
  if (error) throw new Error(`Reading later changes failed: ${error.message}`);
  const later = (data ?? []) as { undo?: Values | null }[];
  if (later.length === 0) return false;
  return later.some((row) => noUndoReason({ undo: row.undo ?? null })) ? 'fixed' : true;
}

/**
 * Carry the plan out. Each write is narrowed to the row as it was just read
 * (its updated_at, where it has one), so a change landing between the read
 * and the write leaves the row alone and the undo refused.
 */
async function apply(deps: DashActionDeps, ref: string, plan: UndoPlan, current: Values | null): Promise<void> {
  const subject = await subjectTable(deps.db, ref);
  if (!subject) throw new Refused('Dash cannot reach that row any more, so it cannot be undone.');
  const { client, table, id } = subject;
  const CHANGED = 'It changed while Dash was undoing it, so Dash left it alone.';

  if (plan.op === 'insert') {
    const { error } = await client.from(table).insert(plan.values).select('id');
    if (error) throw new Refused(`Dash could not put it back: ${error.message}`);
    return;
  }

  let query =
    plan.op === 'delete' ? client.from(table).delete() : client.from(table).update(plan.values);
  query = query.eq('id', id);
  if (current && typeof current.updated_at === 'string') query = query.eq('updated_at', current.updated_at);
  const { data, error } = await query.select('id');
  if (error) throw new Refused(`Dash could not undo it: ${error.message}`);
  if ((data ?? []).length === 0) throw new Refused(CHANGED);
}

/** One action of the person's, or null when there is none with that id. */
export async function loadDashAction(deps: DashActionDeps, id: string): Promise<DashAction | null> {
  const { data, error } = await deps.core
    .from(DASH_ACTIONS_TABLE)
    .select(DASH_ACTION_SELECT)
    .eq('id', id)
    .eq('user_id', deps.userId)
    .maybeSingle();
  if (error) throw new Error(`Reading the change failed: ${error.message}`);
  return data ? toDashAction(data as DashActionRow) : null;
}

/**
 * Undo one of Dash's changes: put the row back as it was before, and mark
 * the action undone. Refused, with the sentence the person reads, when the
 * row has moved on since Dash wrote it.
 */
export async function undoDashAction(deps: DashActionDeps, id: string): Promise<DashActionUndo> {
  const action = await loadDashAction(deps, id);
  if (!action) return { ok: false, error: GONE, action: null };

  const ref = action.subjectRef;
  const [current, later] =
    action.status === 'done' && ref && action.surface !== 'ask' && action.surface !== 'capture'
      ? await Promise.all([readSubject(deps.db, ref), laterActionOn(deps, action)])
      : [null, false];
  const decided = planUndo(action, current, later);
  if (!decided.ok) return { ok: false, error: decided.reason, action };

  if (decided.plan.op === 'delete' && (await hasDependents(deps.db, ref!, action.createdAt))) {
    return {
      ok: false,
      error: 'Something has been added to it since, so undoing would lose that too.',
      action,
    };
  }

  try {
    await apply(deps, ref!, decided.plan, current);
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: error.message, action };
    throw error;
  }

  const { data, error } = await deps.core
    .from(DASH_ACTIONS_TABLE)
    .update({ status: 'undone', undone_at: deps.now ? deps.now() : new Date().toISOString() })
    .eq('id', action.id)
    .eq('user_id', deps.userId)
    .eq('status', 'done')
    .select(DASH_ACTION_SELECT);
  if (error) throw new Error(`Marking the change undone failed: ${error.message}`);
  const rows = (data ?? []) as DashActionRow[];
  if (rows.length === 0) {
    const now = await loadDashAction(deps, id);
    return { ok: false, error: now ? notDone(now.status) : GONE, action: now };
  }
  return { ok: true, action: toDashAction(rows[0]) };
}

// ---------------------------------------------------------------------------
// Recording a change, from the paths that write without asking first
// ---------------------------------------------------------------------------

/** What a writer says about the change it just made. */
export type DashActionEntry = {
  surface: Exclude<DashActionSurface, 'ask'>;
  /** What was done, in snake_case: `file_idea`, `write_cover_letter`. */
  kind: string;
  /** `schema.table:id`, the row written. */
  subjectRef: string;
  op: DashActionOp;
  /** The sentence the person reads for it. */
  summary: string;
  /**
   * The whole row before the write, from readSubjectOrNull, for an update
   * or a delete. Left out for an insert.
   */
  beforeValues?: Values | null;
  /** What undoing needs beyond the row, kept in the `undo` column. */
  undo?: Values | null;
  /**
   * The sentence saying why this change has no Undo, for a write that cannot
   * be put back by restoring its row (noUndoReason). Kept as `undo.none`.
   */
  noUndo?: string;
};

/** Longest summary kept; a longer one is cut at a word. */
const SUMMARY_MAX = 300;

function clipped(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= SUMMARY_MAX) return flat;
  const cut = flat.slice(0, SUMMARY_MAX - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > SUMMARY_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * readSubject for a recorder: the row as it is, or null when it could not be
 * read. A writer reads it before an update or a delete for before_values. A
 * null leaves the record saying what happened without an undo, and never
 * stops the write.
 */
export async function readSubjectOrNull(deps: DashActionDeps, ref: string): Promise<Values | null> {
  try {
    return await readSubject(deps.db, ref);
  } catch (error) {
    console.error(`dash action: could not read ${ref}`, error);
    return null;
  }
}

/**
 * Record a change Dash has just made, as done: the row it touched, what
 * happened to it, its values before (from the caller) and after (read here,
 * for an insert or an update), and the sentence the person reads.
 *
 * Called after the write has landed, and best-effort: the write is what the
 * person asked for, so a record that cannot be written is logged and the
 * write stands. The id of the record comes back, or null when it was not
 * kept.
 */
export async function recordDashAction(
  deps: DashActionDeps,
  entry: DashActionEntry,
): Promise<string | null> {
  try {
    const after = entry.op === 'delete' ? null : await readSubjectOrNull(deps, entry.subjectRef);
    const before = entry.op === 'insert' ? null : (entry.beforeValues ?? null);
    const now = deps.now ? deps.now() : new Date().toISOString();
    const { data, error } = await deps.core
      .from(DASH_ACTIONS_TABLE)
      .insert({
        user_id: deps.userId,
        surface: entry.surface,
        kind: entry.kind,
        status: 'done',
        done_at: now,
        subject_ref: entry.subjectRef,
        op: entry.op,
        before_values: before,
        after_values: after,
        summary: clipped(entry.summary),
        undo: entry.noUndo ? { ...(entry.undo ?? {}), none: entry.noUndo } : (entry.undo ?? null),
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  } catch (error) {
    console.error(`dash action: could not record ${entry.kind} on ${entry.subjectRef}`, error);
    return null;
  }
}

/**
 * Mark a done action undone, for a surface that undid the change by its own
 * rule (capture's per-line Undo). Best-effort, like recording: the undo has
 * already happened, and a record left saying done is put right the next time
 * either Undo is pressed. True when the record now says undone.
 */
export async function markDashActionUndone(deps: DashActionDeps, id: string): Promise<boolean> {
  try {
    const { data, error } = await deps.core
      .from(DASH_ACTIONS_TABLE)
      .update({ status: 'undone', undone_at: deps.now ? deps.now() : new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', deps.userId)
      .eq('status', 'done')
      .select('id');
    if (error) throw new Error(error.message);
    return (data ?? []).length > 0;
  } catch (error) {
    console.error(`dash action: could not mark ${id} undone`, error);
    return false;
  }
}

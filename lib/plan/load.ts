import type { SupabaseClient } from '@supabase/supabase-js';
import { COMMENT_COLUMNS, threadFrom, type DevComment } from '@/lib/comments/load';
import { isModuleId, type ModuleId } from '@/lib/modules';

/**
 * The plan: what is being built, as a tree.
 *
 * Seeded once from `docs/BUILD-ORDER.md` and owned by the app afterwards — see
 * `lib/plan/seed.ts` for why it is a snapshot rather than a mirror. It began
 * as a flat list per module and grew the shape an issue tracker has: a step
 * may hold steps, to any depth, so a feature and the pieces that get you there
 * are one thing seen at two distances rather than two lists that drift.
 *
 * This file is the row shape and the loader. The reading of it — nesting,
 * roll-ups, what is ready to be picked up — is `lib/plan/tree.ts`, pure and
 * tested, because that is the part a CLI and a page both need to agree on.
 */

/**
 * `proposed` is the one a person has not yet said yes to: written into the
 * plan by a session shaping an idea, waiting to be approved, dropped or
 * edited. It is never ready and never built. The rest are the states of a
 * step somebody decided on.
 */
export const PLAN_STATUSES = [
  'proposed',
  'not_started',
  'in_progress',
  'blocked',
  'done',
  'dropped',
] as const;

export type PlanStatus = (typeof PLAN_STATUSES)[number];

export function isPlanStatus(value: string): value is PlanStatus {
  return (PLAN_STATUSES as readonly string[]).includes(value);
}

/** Finished, one way or the other. Neither counts as work outstanding. */
export function isClosed(status: PlanStatus): boolean {
  return status === 'done' || status === 'dropped';
}

/**
 * Which of two things a blocked step is waiting for — see migration 0081.
 *
 * `blocked` was one status covering two situations that want opposite
 * treatment, and #525 settled which is which. A block on `steps` is waiting
 * on rows in `plan_dependencies`, and those close on their own, so the block
 * goes with them. A block on something `outside` the plan — a key, an
 * account, a DNS record, an answer — is waiting on the person, and no amount
 * of work on the plan produces it, so it stays until somebody says otherwise.
 *
 * Two values and no more: the question the column answers is who clears this,
 * and there are two people who can.
 */
export const PLAN_BLOCK_KINDS = ['steps', 'outside'] as const;

export type PlanBlockKind = (typeof PLAN_BLOCK_KINDS)[number];

export function isPlanBlockKind(value: string): value is PlanBlockKind {
  return (PLAN_BLOCK_KINDS as readonly string[]).includes(value);
}

/**
 * What a block is taken to be when whoever wrote it did not say.
 *
 * `outside` is the safe way to be wrong. A block recorded as `outside` that
 * was really about steps sits there until somebody looks at it; one recorded
 * as `steps` that was really about a credential quietly reads as ready the
 * next time an unrelated step closes, and hands a session the afternoon three
 * of them already lost on #499. The page's Blocked control has always meant
 * this one — "the step needs something outside the repo" is what it says
 * about itself.
 */
export const DEFAULT_BLOCK_KIND: PlanBlockKind = 'outside';

/**
 * The block columns to write when a step's status changes.
 *
 * Every path that moves a step through `blocked` writes both of them, so this
 * is the one place that decides what they hold: the kind, which the database
 * requires whenever the status is `blocked`, and the ask, which is cleared on
 * the way out. Off blocked, both go null — a sentence saying what a step needs
 * and a word saying who can supply it stop being true the moment the step
 * moves.
 */
export function blockPatch(
  status: PlanStatus,
  kind?: PlanBlockKind | null,
): { block_kind: PlanBlockKind | null; block_ask?: null } {
  if (status !== 'blocked') return { block_kind: null, block_ask: null };
  return { block_kind: kind ?? DEFAULT_BLOCK_KIND };
}

/**
 * Put aside as "not right now" — see migration 0062.
 *
 * Not a status, because nothing about the row has been settled: a dismissed
 * question is still unanswered and a dismissed step is still unbuilt. It says
 * only that you do not want to be asked again, so everything that asks —
 * the page, the counts, a brief, a re-shape — reads this and leaves it out.
 */
export function isDismissed(item: { dismissedAt: string | null }): boolean {
  return item.dismissedAt !== null;
}

/** Fog that is still being raised: written, and not put aside. */
export function hasLiveFog(item: { fog: string | null; fogDismissedAt: string | null }): boolean {
  return item.fog !== null && item.fogDismissedAt === null;
}

/** 1 next, 2 normal, 3 someday — the same three the notes queue uses. */
export const PLAN_PRIORITIES = [1, 2, 3] as const;
export type PlanPriority = (typeof PLAN_PRIORITIES)[number];

export function isPlanPriority(value: number): value is PlanPriority {
  return (PLAN_PRIORITIES as readonly number[]).includes(value);
}

/** Coarse on purpose: the question is "one sitting or not", not hours. */
export const PLAN_SIZES = ['s', 'm', 'l'] as const;
export type PlanSize = (typeof PLAN_SIZES)[number];

export function isPlanSize(value: string): value is PlanSize {
  return (PLAN_SIZES as readonly string[]).includes(value);
}

/**
 * Who is on it. Two answers, because there are two people who build this app.
 * A step handed to Claude is one the routine may pick up on its own — which is
 * the reason the column exists.
 */
export const PLAN_ASSIGNEES = ['me', 'claude'] as const;
export type PlanAssignee = (typeof PLAN_ASSIGNEES)[number];

export function isPlanAssignee(value: string): value is PlanAssignee {
  return (PLAN_ASSIGNEES as readonly string[]).includes(value);
}

/**
 * What closing a step means.
 *
 * A `build` step closes on a commit. A `decision` closes on an answer: the
 * question and its real options are written by whoever shaped the feature,
 * and the person settles it on the page. A `setup` step closes on the person
 * doing the one thing only they can do — minting a token, opening an
 * account, adding a DNS record — which a session can name and lay out but
 * never supply.
 *
 * All three are kinds rather than statuses because each moves through exactly
 * the states the others move through and differs only in what finishing it
 * looks like — see migrations 0054 and 0084.
 */
export const PLAN_KINDS = ['build', 'decision', 'setup'] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export function isPlanKind(value: string): value is PlanKind {
  return (PLAN_KINDS as readonly string[]).includes(value);
}

export type PlanItem = {
  id: string;
  /** The short, stable handle: "#12". Per account, never reused. */
  number: number;
  module: ModuleId | null;
  /** The step this is part of, or null at the top of a module's plan. */
  parentId: string | null;
  title: string;
  /** What the step involves. The paragraph under the heading. */
  detail: string | null;
  /** Done when. What the work is checked against, written before the work. */
  acceptance: string | null;
  status: PlanStatus;
  /** Whether it closes on a commit or on an answer. */
  kind: PlanKind;
  /**
   * What is not yet known. One paragraph admitting the part of a feature
   * nobody can see far enough into to write steps for. Null once it can be.
   */
  fog: string | null;
  /** The answer a decision closed with, in the person's words. */
  resolution: string | null;
  /**
   * When you said "not right now" to this row. A dismissed question is not
   * answered and not withdrawn: it is out of sight, off every count and out
   * of every re-shape, and the Dismissed view is where it can be found and
   * brought back. Null on everything you have not put aside.
   */
  dismissedAt: string | null;
  /** The same for the fog patch alone, which outlives the row it sits on. */
  fogDismissedAt: string | null;
  /** Your own note on it. Not the plan, but what happened to it. */
  comment: string | null;
  /**
   * What a blocked step needs, in one sentence. Rewritten every time it is
   * blocked and cleared when it stops being blocked, so it says what is wanted
   * now; the dated record of every block it has had stays in `comment`.
   */
  blockAsk: string | null;
  /**
   * Which kind of block it is carrying: `steps`, which clears itself when the
   * steps it names close, or `outside`, which waits for the person. Null on
   * every step that is not blocked, and the database refuses a blocked row
   * without it.
   */
  blockKind: PlanBlockKind | null;
  /**
   * What has been said about it, oldest first: your notes and a session's
   * replies. Not a column — it is read alongside the row — and empty on the
   * paths that do not ask for it, the CLI's direct connection among them.
   */
  thread: DevComment[];
  priority: PlanPriority;
  size: PlanSize | null;
  assignee: PlanAssignee | null;
  /** The commit that shipped it. */
  commitSha: string | null;
  /** Order among its siblings. Sparse, so one can be slotted between two. */
  position: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  /**
   * The last write to this row, kept by a trigger. What the working views
   * order features by: the feature you touched last is the one you are on,
   * and a step closing counts as touching the feature above it.
   */
  updatedAt: string;
};

/** `itemId` cannot start until `dependsOnId` is done. */
export type PlanDependency = {
  id: string;
  itemId: string;
  dependsOnId: string;
};

export type PlanData = {
  items: PlanItem[];
  dependencies: PlanDependency[];
};

/** Every column the app reads off a plan row. Shared with the changelog. */
export const ITEM_COLUMNS =
  'id, number, module, parent_id, title, detail, acceptance, status, kind, fog, resolution, ' +
  'comment, block_ask, block_kind, priority, size, assignee, commit_sha, position, ' +
  'started_at, completed_at, ' +
  'created_at, updated_at, dismissed_at, fog_dismissed_at';

/**
 * Every row of the account's plan, in one read. The whole tree is what the
 * page shows and what a "what next" has to consider, and it is short enough —
 * tens of steps, a hundred at the outside — that reading it whole is cheaper
 * than any query that tries to be clever about which part is wanted.
 */
export async function loadPlan(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public'>,
  userId: string,
): Promise<PlanData> {
  const [{ data: rows }, { data: deps }] = await Promise.all([
    supabase
      .from('plan_items')
      // The thread is read with the row rather than as a second query, the
      // same as on a raise. It is not in ITEM_COLUMNS because an embedded
      // select is PostgREST's and the CLI reads these columns over a direct
      // connection.
      .select(`${ITEM_COLUMNS}, thread:dev_comments(${COMMENT_COLUMNS})`)
      .eq('user_id', userId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('plan_dependencies')
      .select('id, item_id, depends_on_id')
      .eq('user_id', userId),
  ]);

  return {
    items: ((rows ?? []) as unknown as Array<Record<string, unknown>>).map(planItemFromRow),
    dependencies: ((deps ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      itemId: row.item_id as string,
      dependsOnId: row.depends_on_id as string,
    })),
  };
}

/**
 * A row as the app reads it.
 *
 * Every constrained column is read defensively: a module removed from
 * lib/modules leaves a harmless string that reads back as app-wide, and a
 * status or size the check constraint has since stopped naming reads back as
 * the default rather than as something no switch statement handles.
 */
export function planItemFromRow(row: Record<string, unknown>): PlanItem {
  const scope = row.module as string | null;
  // PostgREST hands back ISO strings; a direct connection hands back Dates.
  // One shape leaves here, so a script and the page read the same thing.
  const stamp = (value: unknown): string | null =>
    value instanceof Date ? value.toISOString() : value == null ? null : String(value);
  const status = String(row.status ?? '');
  const kind = String(row.kind ?? '');
  const blockKind = row.block_kind as string | null;
  const size = row.size as string | null;
  const assignee = row.assignee as string | null;
  const priority = Number(row.priority ?? 2);

  return {
    id: row.id as string,
    number: Number(row.number ?? 0),
    module: scope && isModuleId(scope) ? scope : null,
    parentId: (row.parent_id as string | null) ?? null,
    title: row.title as string,
    detail: (row.detail as string | null) ?? null,
    acceptance: (row.acceptance as string | null) ?? null,
    status: isPlanStatus(status) ? status : 'not_started',
    kind: isPlanKind(kind) ? kind : 'build',
    fog: (row.fog as string | null) ?? null,
    resolution: (row.resolution as string | null) ?? null,
    dismissedAt: stamp(row.dismissed_at),
    fogDismissedAt: stamp(row.fog_dismissed_at),
    comment: (row.comment as string | null) ?? null,
    blockAsk: (row.block_ask as string | null) ?? null,
    blockKind: blockKind && isPlanBlockKind(blockKind) ? blockKind : null,
    thread: threadFrom(row.thread),
    priority: isPlanPriority(priority) ? priority : 2,
    size: size && isPlanSize(size) ? size : null,
    assignee: assignee && isPlanAssignee(assignee) ? assignee : null,
    commitSha: (row.commit_sha as string | null) ?? null,
    position: Number(row.position ?? 0),
    startedAt: stamp(row.started_at),
    completedAt: stamp(row.completed_at),
    createdAt: stamp(row.created_at) ?? '',
    updatedAt: stamp(row.updated_at) ?? stamp(row.created_at) ?? '',
  };
}

/**
 * What each step is called, by number, for the hover text on a reference.
 *
 * Off the raw items rather than the tree: a reference can name a step that is
 * closed, dropped or dismissed, and the reader wants to know what it was
 * either way. `lib/comments/refs.ts` says what the label is made of; this is
 * just the lookup it reads.
 */
export function planRefTitles(data: PlanData): Record<number, string> {
  const titles: Record<number, string> = {};
  for (const item of data.items) titles[item.number] = item.title;
  return titles;
}

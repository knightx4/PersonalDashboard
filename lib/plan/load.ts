import type { SupabaseClient } from '@supabase/supabase-js';
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
  /** Your own note on it. Not the plan, but what happened to it. */
  comment: string | null;
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

const ITEM_COLUMNS =
  'id, number, module, parent_id, title, detail, acceptance, status, comment, priority, size, ' +
  'assignee, commit_sha, position, started_at, completed_at, created_at';

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
      .select(ITEM_COLUMNS)
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
    comment: (row.comment as string | null) ?? null,
    priority: isPlanPriority(priority) ? priority : 2,
    size: size && isPlanSize(size) ? size : null,
    assignee: assignee && isPlanAssignee(assignee) ? assignee : null,
    commitSha: (row.commit_sha as string | null) ?? null,
    position: Number(row.position ?? 0),
    startedAt: stamp(row.started_at),
    completedAt: stamp(row.completed_at),
    createdAt: stamp(row.created_at) ?? '',
  };
}

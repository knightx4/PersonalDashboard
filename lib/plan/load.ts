import type { SupabaseClient } from '@supabase/supabase-js';
import { MODULES, isModuleId, type ModuleId } from '@/lib/modules';

/**
 * The plan, per module.
 *
 * Seeded once from `docs/BUILD-ORDER.md` and owned by the app afterwards — see
 * `lib/plan/seed.ts` for why it is a snapshot rather than a mirror. What the
 * markdown could never do is the reason this exists: a third state between
 * done and not, a note against a step saying what it is waiting for, and a
 * step you add yourself.
 */

export const PLAN_STATUSES = ['not_started', 'in_progress', 'done', 'dropped'] as const;

export type PlanStatus = (typeof PLAN_STATUSES)[number];

export function isPlanStatus(value: string): value is PlanStatus {
  return (PLAN_STATUSES as readonly string[]).includes(value);
}

export type PlanItem = {
  id: string;
  module: ModuleId | null;
  title: string;
  detail: string | null;
  status: PlanStatus;
  /** Your own note on it. Not the plan, but what happened to it. */
  comment: string | null;
  position: number;
};

/** One module's steps, and how far through them it is. */
export type PlanSection = {
  module: ModuleId | null;
  label: string;
  items: PlanItem[];
  progress: PlanProgress;
};

export type PlanProgress = {
  done: number;
  inProgress: number;
  /** Steps that count toward the total: everything not dropped. */
  live: number;
  /** 0 to 1 over the live steps, or null when there are none to be through. */
  fraction: number | null;
};

/**
 * How far through a module is.
 *
 * Dropped steps leave the denominator, because a step you decided against is
 * not work outstanding and counting it would hold a finished module at 90%
 * forever. A module whose every step is dropped has no fraction at all rather
 * than a division by zero dressed up as 0%.
 *
 * In-progress counts as started and not as finished. Half-credit would make
 * the bar move when nothing shipped, which is the specific lie a progress bar
 * is worth having only if it does not tell.
 */
export function planProgress(items: readonly PlanItem[]): PlanProgress {
  const live = items.filter((item) => item.status !== 'dropped');
  const done = live.filter((item) => item.status === 'done').length;
  const inProgress = live.filter((item) => item.status === 'in_progress').length;

  return {
    done,
    inProgress,
    live: live.length,
    fraction: live.length === 0 ? null : done / live.length,
  };
}

/**
 * The page's reading order: the modules in the order the switcher lists them,
 * then anything belonging to the app as a whole.
 *
 * Every module gets a section whether or not it has steps yet, because an
 * empty section is the invitation to write the plan for it — a module that
 * simply did not appear would read as one nobody is allowed to plan.
 */
export function planSections(items: readonly PlanItem[]): PlanSection[] {
  const scopes: Array<ModuleId | null> = [...MODULES.map((module) => module.id), null];

  return scopes
    .map((scope) => {
      const forScope = items
        .filter((item) => item.module === scope)
        .sort((a, b) => a.position - b.position);

      return {
        module: scope,
        label: scope ? (MODULES.find((m) => m.id === scope)?.label ?? scope) : 'The app as a whole',
        items: forScope,
        progress: planProgress(forScope),
      };
    })
    // The app-wide section only when something is in it: unlike a module, it
    // is not a place anybody expects to find a plan waiting to be written.
    .filter((section) => section.module !== null || section.items.length > 0);
}

export async function loadPlan(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public'>,
  userId: string,
): Promise<PlanItem[]> {
  const { data } = await supabase
    .from('plan_items')
    .select('id, module, title, detail, status, comment, position')
    .eq('user_id', userId)
    .order('position', { ascending: true });

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const scope = row.module as string | null;
    const status = row.status as string;
    return {
      id: row.id as string,
      // A module removed from lib/modules leaves a harmless string in the
      // column; it reads back as app-wide rather than as a workspace nothing
      // can look up.
      module: scope && isModuleId(scope) ? scope : null,
      title: row.title as string,
      detail: (row.detail as string | null) ?? null,
      status: isPlanStatus(status) ? status : 'not_started',
      comment: (row.comment as string | null) ?? null,
      position: (row.position as number | null) ?? 0,
    };
  });
}

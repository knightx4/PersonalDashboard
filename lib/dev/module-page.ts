import type { Crumb } from '@/components/shell/breadcrumb';
import { isOutstanding, type FeedbackRow } from '@/lib/feedback/load';
import type { IdeaRow } from '@/lib/ideas/load';
import { MODULES, moduleForPath, type AppModule, type ModuleId } from '@/lib/modules';
import { isClosed, isDismissed, type PlanItem } from '@/lib/plan/load';
import { SPECS, type SpecDoc } from '@/lib/specs/registry';
import type { ScopeReview } from '@/lib/ui-review/load';
import type { PageOpens } from '@/lib/usage/opens';
import type { UsageGroup } from '@/lib/usage/report';

/**
 * One module's page in Dev: everything Dev holds about a single workspace,
 * gathered from the lists that already tag it.
 *
 * Each of those lists (the plan, the bugs, the ideas, the specs, the UI
 * reviews, the usage) is its own page across every module. This puts the
 * rows for one module side by side, so the state of Jobs can be read without
 * filtering six pages one at a time. Pure, so the page, the index and the
 * gallery read the same answers.
 */

/** The tabs on a module's page, in order. Overview is the page's own address. */
export const MODULE_TABS = [
  'overview',
  'plan',
  'bugs',
  'ideas',
  'spec',
  'ui',
  'usage',
  'changelog',
] as const;
export type ModuleTab = (typeof MODULE_TABS)[number];

/** How many shipped steps the Changelog tab lists, newest first. */
export const SHIPPED_LIMIT = 30;

/** How many rows of each list the Overview shows before its link to the rest. */
export const OVERVIEW_LIMIT = 3;

export type ModuleInputs = {
  plan: readonly PlanItem[];
  /** Every note in the queue; the outstanding ones are picked out here. */
  bugs: readonly FeedbackRow[];
  /** Ideas still live: yours and the suggestions, not shaped or dismissed. */
  ideas: readonly IdeaRow[];
  visions: Partial<Record<string, { body: string }>>;
  ui: readonly ScopeReview[];
  usage: readonly UsageGroup[];
  /** Pages not opened in 30 days, from the same usage report. */
  notOpened: readonly PageOpens[];
};

export type ModuleSummary = {
  module: AppModule;
  vision: string | null;
  /** Open features at the top of the module's plan, last touched first. */
  features: PlanItem[];
  /** Open steps anywhere under the module's features, the features included. */
  openSteps: number;
  /** Steps shipped, newest first, at most SHIPPED_LIMIT. */
  shipped: PlanItem[];
  /** Outstanding bugs and requests filed from one of the module's pages. */
  bugs: FeedbackRow[];
  ideas: IdeaRow[];
  specs: SpecDoc[];
  /** Null when the UI review has no scope for this module. */
  ui: ScopeReview | null;
  /** Null when none of the module's pages has been opened and nothing was spent. */
  usage: UsageGroup | null;
  /** The module's pages not opened in 30 days, longest unopened first. */
  notOpened: PageOpens[];
};

/** The address of a module's page. */
export function moduleHref(id: ModuleId): string {
  return `/dev/modules/${id}`;
}

/** The path down to the module index, or to one module's page when given. */
export function moduleCrumbs(module?: AppModule): Crumb[] {
  const crumbs: Crumb[] = [
    { label: 'Dev', href: '/dev' },
    { label: 'Modules', href: '/dev/modules' },
  ];
  if (module) crumbs.push({ label: module.label, href: moduleHref(module.id) });
  return crumbs;
}

/**
 * The module each plan row belongs to, read off the feature at the top of its
 * branch. A step's own `module` column is not trusted on its own: the feature
 * is what the plan page files a step under, so this agrees with it.
 */
function planModules(plan: readonly PlanItem[]): Map<string, string | null> {
  const byId = new Map(plan.map((item) => [item.id, item]));
  const resolved = new Map<string, string | null>();
  const resolve = (item: PlanItem, depth = 0): string | null => {
    const held = resolved.get(item.id);
    if (held !== undefined) return held;
    const parent = item.parentId ? byId.get(item.parentId) : undefined;
    // The depth guard is for a cycle, which the database refuses but a
    // fixture could hold.
    const scope = parent && depth < 50 ? resolve(parent, depth + 1) : item.module;
    resolved.set(item.id, scope);
    return scope;
  };
  for (const item of plan) resolve(item);
  return resolved;
}

function newestFirst(a: string | null, b: string | null): number {
  return (b ?? '').localeCompare(a ?? '');
}

export function moduleSummary(
  module: AppModule,
  inputs: ModuleInputs,
  modules = planModules(inputs.plan),
): ModuleSummary {
  const id = module.id;
  const mine = inputs.plan.filter((item) => modules.get(item.id) === id && !isDismissed(item));
  const open = mine.filter((item) => !isClosed(item.status));

  return {
    module,
    vision: inputs.visions[id]?.body ?? null,
    features: open
      .filter((item) => item.parentId === null)
      .sort((a, b) => newestFirst(a.updatedAt, b.updatedAt)),
    openSteps: open.length,
    shipped: mine
      .filter((item) => item.status === 'done')
      .sort((a, b) => newestFirst(a.completedAt, b.completedAt))
      .slice(0, SHIPPED_LIMIT),
    bugs: inputs.bugs.filter((row) => isOutstanding(row) && moduleForPath(row.pagePath) === id),
    ideas: inputs.ideas.filter((idea) => idea.module === id),
    specs: SPECS.filter((spec) => spec.module === id),
    ui: inputs.ui.find((row) => row.scope === id) ?? null,
    usage: inputs.usage.find((group) => group.workspace === id) ?? null,
    notOpened: inputs.notOpened.filter((page) => page.workspace === id),
  };
}

/** Every module's summary, in the order the switcher lists them. */
export function moduleSummaries(inputs: ModuleInputs): ModuleSummary[] {
  const modules = planModules(inputs.plan);
  return MODULES.map((module) => moduleSummary(module, inputs, modules));
}

/** "3 bugs", "1 idea": a count and its noun, the noun made plural when it needs to be. */
export function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** The UI review's standing in a few words, which says never when nobody has looked. */
export function uiLine(ui: ScopeReview | null): string {
  if (!ui?.lastReview) return 'Never reviewed';
  const date = ui.lastReview.createdAt.slice(0, 10);
  const open = ui.openFindings.length;
  return open === 0 ? `Reviewed ${date}` : `Reviewed ${date}, ${open} to decide`;
}

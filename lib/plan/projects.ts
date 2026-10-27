/**
 * Projects the plan builds that are not this app.
 *
 * A project sits in Dev the way a workspace does: its features and steps are
 * plan rows with `module` set to the project's id, it gets its own section on
 * /dev/plan (and no entry in the Dev sidebar: note 4308875b), and "Send to Dash" hands its
 * steps to a routine that checks out the project's repository instead of this
 * one. It is not a workspace: it has no pages here, no place in the switcher,
 * and no vision, which is why it is not in lib/modules.
 *
 * The projects are rows in `public.dev_projects` (migration 0282, plan
 * #2553.1), so one is added, renamed or archived without a deploy. Nothing
 * here holds a list of its own: every helper that needs the projects takes
 * the list a caller loaded, once per request, with `loadDevProjects` (or with
 * the plan, which carries it as `PlanData.projects`).
 *
 * A row may still name the environment variables holding its own routine
 * (`routineEnv`), because a routine's token is scoped to that routine (see
 * lib/feedback/routine.ts). Neither falls back to the plan routine's: that
 * routine checks out this repository, and a website step built there would
 * land in the wrong repo.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { MODULES, isModuleId, type ModuleId } from '@/lib/modules';
import { REPO, type Repo } from './github';

/** A project's slug, as `dev_projects.id` and a plan row's `module` hold it. */
export type ProjectId = string;

export type DevProject = {
  id: ProjectId;
  label: string;
  /** The line under the label. */
  description: string;
  /** Where the steps are built, as GitHub names it. */
  repo: { owner: string; repo: string; branch: string };
  /** The site the repository deploys, for the brief and the page. Null when it deploys none. */
  url: string | null;
  /** The skill in the project's repository that says how a step is built. */
  skill: string;
  /** The command a session runs in that repository before pushing, when it has one. */
  checkCommand: string | null;
  /** When the repository was made ready for Dash to build in. */
  setUpAt: string | null;
  /** When it was put away. An archived project draws no section. */
  archivedAt: string | null;
  /** Environment variables holding a routine of the project's own, when it has one. */
  routineEnv: { id: string; token: string } | null;
};

/** The columns `projectFromRow` reads. */
export const PROJECT_COLUMNS =
  'id, label, description, owner, repo, branch, url, skill, check_command, set_up_at, archived_at, ' +
  'routine_id_env, routine_token_env, created_at';

/** What a project id looks like: the check on `dev_projects.id`. */
const SLUG = /^[a-z][a-z0-9-]{0,39}$/;

/**
 * One `dev_projects` row as a project, or null for a row the plan cannot use:
 * a malformed id, or one that is a workspace's, whose steps the plan would
 * file under the workspace instead.
 */
export function projectFromRow(row: Record<string, unknown>): DevProject | null {
  const id = typeof row.id === 'string' ? row.id : '';
  if (!SLUG.test(id) || isModuleId(id)) return null;
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value : null;
  // A direct connection hands back Dates where PostgREST hands back strings.
  const stamp = (value: unknown): string | null =>
    value instanceof Date ? value.toISOString() : value == null ? null : String(value);
  const routineId = text(row.routine_id_env);
  const routineToken = text(row.routine_token_env);
  return {
    id,
    label: text(row.label) ?? id,
    description: text(row.description) ?? '',
    repo: {
      owner: String(row.owner ?? ''),
      repo: String(row.repo ?? ''),
      branch: text(row.branch) ?? 'main',
    },
    url: text(row.url),
    skill: text(row.skill) ?? '.claude/skills/plan/SKILL.md',
    checkCommand: text(row.check_command),
    setUpAt: stamp(row.set_up_at),
    archivedAt: stamp(row.archived_at),
    routineEnv: routineId && routineToken ? { id: routineId, token: routineToken } : null,
  };
}

/** Rows as projects, in the order they were set up, dropping any the plan cannot use. */
export function projectsFromRows(rows: readonly Record<string, unknown>[]): DevProject[] {
  return rows.flatMap((row) => {
    const project = projectFromRow(row);
    return project ? [project] : [];
  });
}

/**
 * The account's projects, archived ones included (their labels still name
 * the rows filed under them). A read that fails is logged and reads as no
 * projects: the plan then draws a project's rows under its bare id rather
 * than not drawing the page.
 */
export async function loadDevProjects(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any>,
  userId: string,
): Promise<DevProject[]> {
  try {
    const { data, error } = await supabase
      .from('dev_projects')
      .select(PROJECT_COLUMNS)
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    if (error) throw new Error(error.message);
    return projectsFromRows((data ?? []) as unknown as Record<string, unknown>[]);
  } catch (err) {
    console.error(
      `the Dev projects could not be read: ${err instanceof Error ? err.message : 'failed'}`,
    );
    return [];
  }
}

/** The projects still being built: the ones that get a section. */
export function activeProjects(projects: readonly DevProject[]): DevProject[] {
  return projects.filter((project) => !project.archivedAt);
}

export function isProjectId(projects: readonly DevProject[], value: string): boolean {
  return projects.some((project) => project.id === value);
}

export function projectById(
  projects: readonly DevProject[],
  id: string | null | undefined,
): DevProject | undefined {
  return id ? projects.find((project) => project.id === id) : undefined;
}

/**
 * What a plan row's `module` column may hold: a workspace of this app, or a
 * project it builds elsewhere. Null is the app as a whole.
 */
export type PlanScope = ModuleId | ProjectId;

/**
 * Whether a stored scope names a project rather than a workspace, without
 * the list: anything that is not a workspace is one. What a caller with no
 * projects loaded (a client component) uses to tell the two apart.
 */
export function isProjectScope(scope: PlanScope | null): scope is ProjectId {
  return scope !== null && !isModuleId(scope);
}

/** Whether a value may be written as a row's scope: a workspace, or an active project. */
export function isPlanScope(value: string, projects: readonly DevProject[]): value is PlanScope {
  return isModuleId(value) || isProjectId(activeProjects(projects), value);
}

/** Read a scope someone asked for: anything that is not a workspace or an active project is app-wide. */
export function planScopeOf(value: unknown, projects: readonly DevProject[]): PlanScope | null {
  return typeof value === 'string' && isPlanScope(value, projects) ? value : null;
}

/**
 * Read a scope a plan row already holds. A workspace stays itself, and any
 * other slug is kept as the project it names, loaded or not, so a project's
 * rows never pass for app-wide ones because the list was not at hand.
 */
export function storedScopeOf(value: unknown): PlanScope | null {
  if (typeof value !== 'string') return null;
  return isModuleId(value) || SLUG.test(value) ? value : null;
}

export function planScopeLabel(scope: PlanScope | null, projects: readonly DevProject[]): string {
  if (!scope) return 'The app as a whole';
  return (
    MODULES.find((module) => module.id === scope)?.label ?? projectById(projects, scope)?.label ?? scope
  );
}

/** Every scope the plan page draws a section for, in order: workspaces, then active projects. */
export function planScopes(projects: readonly DevProject[]): PlanScope[] {
  return [...MODULES.map((module) => module.id), ...activeProjects(projects).map((project) => project.id)];
}

/**
 * Whether a scope belongs to this app: a workspace, or the app as a whole.
 * The changelog and the morning digest are about this app, so they keep only
 * these; a project's history is its own repository's.
 */
export function isAppScope(scope: PlanScope | null): scope is ModuleId | null {
  return scope === null || isModuleId(scope);
}

/**
 * The scope each plan row's root holds, by row id: the workspace or project
 * its top-level feature was filed under. A step moved under another feature
 * may still carry its old `module`, so what a step is built in is read from
 * its root rather than from the step (plan #2553.2). A row whose parent is
 * missing counts as its own root.
 */
export function rootScopes(
  rows: ReadonlyArray<{ id: string; parentId: string | null; module: string | null }>,
): Map<string, PlanScope | null> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const out = new Map<string, PlanScope | null>();
  const rootOf = (id: string, seen: Set<string>): PlanScope | null => {
    const known = out.get(id);
    if (known !== undefined) return known;
    const row = byId.get(id)!;
    const parent = row.parentId ? byId.get(row.parentId) : undefined;
    const scope =
      parent && !seen.has(parent.id)
        ? rootOf(parent.id, seen.add(id))
        : storedScopeOf(row.module);
    out.set(id, scope);
    return scope;
  };
  for (const row of rows) rootOf(row.id, new Set());
  return out;
}

/**
 * The repository a scope's steps are built in: the project's, for a project
 * the list knows, and this app's for everything else.
 */
export function repoForScope(scope: PlanScope | null, projects: readonly DevProject[]): Repo {
  const project = isProjectScope(scope) ? projectById(projects, scope) : undefined;
  return project ? project.repo : REPO;
}

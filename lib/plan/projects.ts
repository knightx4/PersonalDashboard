/**
 * Projects the plan builds that are not this app.
 *
 * A project sits in Dev the way a workspace does: its features and steps are
 * plan rows with `module` set to the project's id, it gets its own section on
 * /dev/plan and its own entry in the Dev sidebar, and "Send to Dash" hands its
 * steps to a routine that checks out the project's repository instead of this
 * one. It is not a workspace: it has no pages here, no place in the switcher,
 * and no vision, which is why it lives in this list rather than in
 * lib/modules.
 *
 * The routine is a pair of environment variables per project, because a
 * routine's token is scoped to that routine (see lib/feedback/routine.ts).
 * Neither falls back to the plan routine's: that routine checks out this
 * repository, and a website step built there would land in the wrong repo.
 */
import { MODULES, isModuleId, type ModuleId } from '@/lib/modules';

export type ProjectId = 'website';

export type DevProject = {
  id: ProjectId;
  label: string;
  /** The line under the label in the Dev sidebar. */
  description: string;
  /** Where the steps are built, as GitHub names it. */
  repo: { owner: string; repo: string; branch: string };
  /** The site the repository deploys, for the brief and the page. */
  url: string;
  /** The skill in the project's repository that says how a step is built. */
  skill: string;
  /** Environment variables holding the routine that builds this project. */
  routineEnv: { id: string; token: string };
};

export const PROJECTS: readonly DevProject[] = [
  {
    id: 'website',
    label: 'selveyknight.com',
    description: 'The personal website',
    repo: { owner: 'knightx4', repo: 'selveyknightwebsite', branch: 'main' },
    url: 'https://selveyknight.com',
    skill: '.claude/skills/plan/SKILL.md',
    routineEnv: { id: 'CLAUDE_WEBSITE_ROUTINE_ID', token: 'CLAUDE_WEBSITE_ROUTINE_TOKEN' },
  },
];

export function isProjectId(value: string): value is ProjectId {
  return PROJECTS.some((project) => project.id === value);
}

export function projectById(id: string | null | undefined): DevProject | undefined {
  return PROJECTS.find((project) => project.id === id);
}

/**
 * What a plan row's `module` column may hold: a workspace of this app, or a
 * project it builds elsewhere. Null is the app as a whole.
 */
export type PlanScope = ModuleId | ProjectId;

export function isPlanScope(value: string): value is PlanScope {
  return isModuleId(value) || isProjectId(value);
}

/** Read a stored `module` defensively: anything unknown reads as app-wide. */
export function planScopeOf(value: unknown): PlanScope | null {
  return typeof value === 'string' && isPlanScope(value) ? value : null;
}

export function planScopeLabel(scope: PlanScope | null): string {
  if (!scope) return 'The app as a whole';
  return MODULES.find((module) => module.id === scope)?.label ?? projectById(scope)?.label ?? scope;
}

/** Every scope the plan page draws a section for, in order: workspaces, then projects. */
export const PLAN_SCOPES: readonly PlanScope[] = [
  ...MODULES.map((module) => module.id),
  ...PROJECTS.map((project) => project.id),
];

/**
 * Whether a scope belongs to this app: a workspace, or the app as a whole.
 * The changelog and the morning digest are about this app, so they keep only
 * these; a project's history is its own repository's.
 */
export function isAppScope(scope: PlanScope | null): scope is ModuleId | null {
  return scope === null || isModuleId(scope);
}

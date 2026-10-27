import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activeProjects,
  isAppScope,
  isPlanScope,
  isProjectScope,
  loadProjectStepIds,
  planScopeLabel,
  planScopeOf,
  planScopes,
  projectById,
  projectFromRow,
  projectsFromRows,
  repoForScope,
  rootScopes,
  storedScopeOf,
} from './projects';
import { PROJECT_FIXTURES, WEBSITE_FIXTURE } from './project-fixtures';
import { projectRoutine } from '@/lib/feedback/routine';

const ARCHIVED = { ...WEBSITE_FIXTURE, id: 'old-site', label: 'Old site', archivedAt: '2026-10-01T00:00:00Z' };

/** The website's row as dev_projects holds it (migration 0282). */
const WEBSITE_ROW = {
  id: 'website',
  label: 'selveyknight.com',
  description: 'The personal website',
  owner: 'knightx4',
  repo: 'selveyknightwebsite',
  branch: 'main',
  url: 'https://selveyknight.com',
  skill: '.claude/skills/plan/SKILL.md',
  check_command: null,
  set_up_at: '2026-10-26T00:00:00Z',
  archived_at: null,
  routine_id_env: 'CLAUDE_WEBSITE_ROUTINE_ID',
  routine_token_env: 'CLAUDE_WEBSITE_ROUTINE_TOKEN',
  created_at: '2026-10-26T00:00:00Z',
};

describe('project rows', () => {
  it('reads the website row as the project the array used to hold', () => {
    expect(projectFromRow(WEBSITE_ROW)).toEqual(WEBSITE_FIXTURE);
  });

  it('drops a row whose id is a workspace or not a slug', () => {
    expect(projectFromRow({ ...WEBSITE_ROW, id: 'jobs' })).toBeNull();
    expect(projectFromRow({ ...WEBSITE_ROW, id: 'Not A Slug' })).toBeNull();
    expect(projectsFromRows([WEBSITE_ROW, { ...WEBSITE_ROW, id: 'dev' }]).map((p) => p.id)).toEqual([
      'website',
    ]);
  });

  it('goes to the shared projects routine when the row names no variables', () => {
    vi.stubEnv('CLAUDE_PROJECTS_ROUTINE_ID', 'trig_projects');
    vi.stubEnv('CLAUDE_PROJECTS_ROUTINE_TOKEN', 'projects-token');
    const plain = projectFromRow({ ...WEBSITE_ROW, id: 'blog', routine_id_env: null, routine_token_env: null })!;
    expect(plain.routineEnv).toBeNull();
    expect(projectRoutine(plain)).toEqual({ id: 'trig_projects', token: 'projects-token' });
  });

  it("prefers a project's own routine while its id is set, and falls back once it is not", () => {
    vi.stubEnv('CLAUDE_PROJECTS_ROUTINE_ID', 'trig_projects');
    vi.stubEnv('CLAUDE_PROJECTS_ROUTINE_TOKEN', 'projects-token');
    vi.stubEnv('CLAUDE_WEBSITE_ROUTINE_ID', 'trig_site');
    vi.stubEnv('CLAUDE_WEBSITE_ROUTINE_TOKEN', 'site-token');
    expect(projectRoutine(WEBSITE_FIXTURE)).toEqual({ id: 'trig_site', token: 'site-token' });
    vi.stubEnv('CLAUDE_WEBSITE_ROUTINE_ID', '');
    expect(projectRoutine(WEBSITE_FIXTURE)).toEqual({ id: 'trig_projects', token: 'projects-token' });
  });

  it('never falls back to the plan routine or the shared token', () => {
    vi.stubEnv('CLAUDE_PROJECTS_ROUTINE_ID', '');
    vi.stubEnv('CLAUDE_PROJECTS_ROUTINE_TOKEN', '');
    vi.stubEnv('CLAUDE_WEBSITE_ROUTINE_ID', '');
    vi.stubEnv('CLAUDE_PLAN_ROUTINE_ID', 'trig_plan');
    vi.stubEnv('CLAUDE_FEATURE_ROUTINE_ID', 'trig_feature');
    vi.stubEnv('CLAUDE_API_KEY', 'shared');
    expect(projectRoutine(WEBSITE_FIXTURE)).toEqual({ id: null, token: null });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A client answering `plan_items` reads from these rows, by the ids asked for. */
function planItemsClient(
  rows: Array<{ id: string; parent_id: string | null; module: string | null }>,
  calls: string[][] = [],
) {
  return {
    from: () => {
      let ids: string[] = [];
      const query = {
        select: () => query,
        eq: () => query,
        in: (_column: string, values: string[]) => {
          ids = values;
          calls.push(values);
          return query;
        },
        then: (resolve: (value: unknown) => void) =>
          resolve({ data: rows.filter((row) => ids.includes(row.id)), error: null }),
      };
      return query;
    },
  } as never;
}

describe('the steps under a project', () => {
  const rows = [
    { id: 'site', parent_id: null, module: 'website' },
    { id: 'site-feature', parent_id: 'site', module: 'website' },
    { id: 'site-step', parent_id: 'site-feature', module: null },
    { id: 'app', parent_id: null, module: 'dev' },
    { id: 'moved', parent_id: 'app', module: 'website' },
  ];

  it("reads each step's root, one level at a time, and keeps the ones under a project", async () => {
    const calls: string[][] = [];
    const ids = await loadProjectStepIds(planItemsClient(rows, calls), 'u', [
      'site-step',
      'moved',
      'app',
    ]);
    expect([...ids]).toEqual(['site-step']);
    expect(calls).toEqual([['site-step', 'moved', 'app'], ['site-feature'], ['site']]);
  });

  it('reads none under a project when the read fails', async () => {
    const failing = {
      from: () => {
        throw new Error('down');
      },
    } as never;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await loadProjectStepIds(failing, 'u', ['site-step'])).size).toBe(0);
  });
});

describe('plan scopes', () => {
  it('takes a workspace or an active project, against the loaded list', () => {
    expect(isPlanScope('jobs', [])).toBe(true);
    expect(isPlanScope('website', PROJECT_FIXTURES)).toBe(true);
    expect(isPlanScope('website', [])).toBe(false);
    expect(isPlanScope('old-site', [ARCHIVED])).toBe(false);
    expect(isPlanScope('garden', PROJECT_FIXTURES)).toBe(false);
  });

  it('reads anything asked for that it does not know as the app as a whole', () => {
    expect(planScopeOf('website', PROJECT_FIXTURES)).toBe('website');
    expect(planScopeOf('garden', PROJECT_FIXTURES)).toBeNull();
    expect(planScopeOf(null, PROJECT_FIXTURES)).toBeNull();
    expect(planScopeOf(3, PROJECT_FIXTURES)).toBeNull();
  });

  it('keeps a stored project id whether or not the list is loaded', () => {
    expect(storedScopeOf('website')).toBe('website');
    expect(storedScopeOf('jobs')).toBe('jobs');
    expect(storedScopeOf('Not A Slug')).toBeNull();
    expect(storedScopeOf(null)).toBeNull();
    expect(isProjectScope('website')).toBe(true);
    expect(isProjectScope('jobs')).toBe(false);
    expect(isProjectScope(null)).toBe(false);
  });

  it('labels a project by its row and a workspace by its name', () => {
    expect(planScopeLabel('website', PROJECT_FIXTURES)).toBe('selveyknight.com');
    expect(planScopeLabel('website', [])).toBe('website');
    expect(planScopeLabel('jobs', [])).toBe('Job search');
    expect(planScopeLabel(null, [])).toBe('The app as a whole');
  });

  it('counts only workspaces and the app as this app', () => {
    expect(isAppScope(null)).toBe(true);
    expect(isAppScope('dev')).toBe(true);
    expect(isAppScope('website')).toBe(false);
  });

  it('lists the active projects after the workspaces', () => {
    expect(planScopes([...PROJECT_FIXTURES, ARCHIVED]).at(-1)).toBe('website');
    expect(activeProjects([ARCHIVED])).toEqual([]);
  });

  it('builds the website in its own repository', () => {
    expect(projectById(PROJECT_FIXTURES, 'website')?.repo).toEqual({
      owner: 'knightx4',
      repo: 'selveyknightwebsite',
      branch: 'main',
    });
  });
});

describe('the repository a step is built in', () => {
  it("reads a step's scope from its root feature", () => {
    const roots = rootScopes([
      { id: 'feature', parentId: null, module: 'website' },
      { id: 'step', parentId: 'feature', module: 'dev' },
      { id: 'sub', parentId: 'step', module: null },
      { id: 'orphan', parentId: 'gone', module: 'jobs' },
      { id: 'loop-a', parentId: 'loop-b', module: 'learn' },
      { id: 'loop-b', parentId: 'loop-a', module: 'learn' },
    ]);
    expect(roots.get('step')).toBe('website');
    expect(roots.get('sub')).toBe('website');
    expect(roots.get('orphan')).toBe('jobs');
    expect(roots.get('loop-a')).toBe('learn');
  });

  it("gives a project's repository for its scope and this app's for the rest", () => {
    expect(repoForScope('website', PROJECT_FIXTURES)).toEqual(WEBSITE_FIXTURE.repo);
    expect(repoForScope('dev', PROJECT_FIXTURES).repo).toBe('PersonalDashboard');
    expect(repoForScope(null, PROJECT_FIXTURES).repo).toBe('PersonalDashboard');
    expect(repoForScope('unknown-project', PROJECT_FIXTURES).repo).toBe('PersonalDashboard');
  });
});

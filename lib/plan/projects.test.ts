import { describe, expect, it } from 'vitest';
import {
  activeProjects,
  isAppScope,
  isPlanScope,
  isProjectScope,
  planScopeLabel,
  planScopeOf,
  planScopes,
  projectById,
  projectFromRow,
  projectsFromRows,
  storedScopeOf,
} from './projects';
import { PROJECT_FIXTURES, WEBSITE_FIXTURE } from './project-fixtures';
import { projectRoutine, projectRoutineIds } from '@/lib/feedback/routine';

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

  it('has no routine of its own when the row names no variables', () => {
    const plain = projectFromRow({ ...WEBSITE_ROW, id: 'blog', routine_id_env: null, routine_token_env: null })!;
    expect(plain.routineEnv).toBeNull();
    expect(projectRoutine(plain).id).toBeNull();
    expect(projectRoutineIds([plain]).size).toBe(0);
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

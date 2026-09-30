import { describe, expect, it } from 'vitest';
import {
  PLAN_SCOPES,
  isAppScope,
  isPlanScope,
  planScopeLabel,
  planScopeOf,
  projectById,
} from './projects';

describe('plan scopes', () => {
  it('takes a workspace, a project, or nothing', () => {
    expect(isPlanScope('jobs')).toBe(true);
    expect(isPlanScope('website')).toBe(true);
    expect(isPlanScope('garden')).toBe(false);
  });

  it('reads anything it does not know as the app as a whole', () => {
    expect(planScopeOf('website')).toBe('website');
    expect(planScopeOf('garden')).toBeNull();
    expect(planScopeOf(null)).toBeNull();
    expect(planScopeOf(3)).toBeNull();
  });

  it('labels a project by its site and a workspace by its name', () => {
    expect(planScopeLabel('website')).toBe('selveyknight.com');
    expect(planScopeLabel('jobs')).toBe('Job search');
    expect(planScopeLabel(null)).toBe('The app as a whole');
  });

  it('counts only workspaces and the app as this app', () => {
    expect(isAppScope(null)).toBe(true);
    expect(isAppScope('dev')).toBe(true);
    expect(isAppScope('website')).toBe(false);
  });

  it('lists the projects after the workspaces', () => {
    expect(PLAN_SCOPES.at(-1)).toBe('website');
  });

  it('builds the website in its own repository', () => {
    expect(projectById('website')?.repo).toEqual({
      owner: 'knightx4',
      repo: 'selveyknightwebsite',
      branch: 'main',
    });
  });
});

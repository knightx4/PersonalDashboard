import type { DevProject } from './projects';

/**
 * The website as its dev_projects row reads (migration 0282), for the gallery
 * and the tests, which draw a project's section with no database behind them.
 * The live list is the account's rows; nothing outside a fixture reads this.
 */
export const WEBSITE_FIXTURE: DevProject = {
  id: 'website',
  label: 'alexrivera.dev',
  description: 'The personal website',
  repo: { owner: 'example-owner', repo: 'alexrivera-site', branch: 'main' },
  url: 'https://alexrivera.dev',
  skill: '.claude/skills/plan/SKILL.md',
  checkCommand: null,
  setUpAt: '2026-10-26T00:00:00Z',
  archivedAt: null,
  routineEnv: { id: 'CLAUDE_WEBSITE_ROUTINE_ID', token: 'CLAUDE_WEBSITE_ROUTINE_TOKEN' },
};

export const PROJECT_FIXTURES: readonly DevProject[] = [WEBSITE_FIXTURE];

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanData, PlanItem } from './load';

const plan: { data: PlanData } = { data: { items: [], dependencies: [] } };
const started: string[] = [];
const routines: unknown[] = [];

vi.mock('./load', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./load')>()),
  loadPlan: vi.fn(async () => plan.data),
}));
vi.mock('./runs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./runs')>()),
  loadLastRuns: vi.fn(async () => ({})),
  reshapeUnderway: vi.fn(async () => false),
  endRunsOnStep: vi.fn(async () => undefined),
  startRoutineRun: vi.fn(async (input: { text: string; routine: unknown }) => {
    started.push(input.text);
    routines.push(input.routine);
    return { ok: true, detail: 'Started.' };
  }),
}));
vi.mock('@/lib/specs/vision', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/specs/vision')>()),
  loadVisionBodies: vi.fn(async () => ({})),
}));

import { builderFor, handFeatureToClaude, handStepToClaude } from './handover';
import { buildPlanTree, findNode } from './tree';
import { PROJECT_FIXTURES } from './project-fixtures';

function item(over: Partial<PlanItem> & { id: string; number: number; title: string }): PlanItem {
  return {
    module: null,
    parentId: null,
    detail: null,
    acceptance: null,
    status: 'not_started',
    kind: 'build',
    track: 'feature',
    resolution: null,
    dismissedAt: null,
    comment: null,
    blockAsk: null,
    blockKind: null,
    thread: [],
    priority: 2,
    size: null,
    assignee: null,
    commitSha: null,
    position: over.number,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-10-01T09:00:00Z',
    updatedAt: '2026-10-01T09:00:00Z',
    ...over,
  };
}

// Every write the press makes resolves with no error.
const chain: Record<string, unknown> = {};
for (const name of ['from', 'update', 'eq']) chain[name] = () => chain;
chain.then = (resolve: (value: { error: null }) => void) => resolve({ error: null });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = chain as any;

beforeEach(() => {
  started.length = 0;
  plan.data = {
    items: [
      item({ id: 'f', number: 1073, title: 'Feature' }),
      item({ id: 'a', number: 1080, title: 'First', parentId: 'f' }),
      item({ id: 'b', number: 1084, title: 'The step', parentId: 'f' }),
      item({ id: 'p', number: 1090, title: 'An idea', parentId: 'f', status: 'proposed' }),
    ],
    dependencies: [],
  };
});

describe('handing a step to a session', () => {
  it('names the step by its outline, so the session says it back the way the page reads', async () => {
    const sent = await handStepToClaude({ supabase, userId: 'u', id: 'b' });
    expect(sent).toMatchObject({ ok: true, number: 1084, outline: '1073.2' });
    expect(started[0]).toMatch(/^Build plan step #1073\.2, "The step"/);
    expect(started[0]).not.toContain('#1084');
  });

  it('refuses a proposal by its outline', async () => {
    const sent = await handStepToClaude({ supabase, userId: 'u', id: 'p' });
    expect(sent).toEqual({ ok: false, error: '#1073.3 is only a proposal. Approve it first.' });
  });

  it('names a feature by its outline too', async () => {
    const sent = await handFeatureToClaude({ supabase, userId: 'u', id: 'f' });
    expect(sent).toMatchObject({ ok: true, outline: '1073' });
    expect(started[0]).toMatch(/^Work plan feature #1073, "Feature"/);
  });
});

describe('where a row is built', () => {
  const site = [
    item({ id: 's', number: 2000, title: 'Site feature', module: 'website' }),
    item({ id: 't', number: 2001, title: 'Site step', module: 'website', parentId: 's' }),
  ];

  it("builds a project's row with the project off its section", () => {
    vi.stubEnv('CLAUDE_WEBSITE_ROUTINE_ID', 'trig_site');
    vi.stubEnv('CLAUDE_WEBSITE_ROUTINE_TOKEN', 'token');
    const sections = buildPlanTree({ items: site, dependencies: [], projects: PROJECT_FIXTURES });
    const built = builderFor(sections, findNode(sections, 't')!);
    expect(built).toMatchObject({ ok: true, project: { id: 'website' }, routine: { id: 'trig_site' } });
    vi.unstubAllEnvs();
  });

  it('sends a project with no routine of its own to the shared routine, naming its repository', async () => {
    vi.stubEnv('CLAUDE_PROJECTS_ROUTINE_ID', 'trig_projects');
    vi.stubEnv('CLAUDE_PROJECTS_ROUTINE_TOKEN', 'projects-token');
    vi.stubEnv('CLAUDE_WEBSITE_ROUTINE_ID', '');
    plan.data = { items: site, dependencies: [], projects: PROJECT_FIXTURES };
    const sections = buildPlanTree(plan.data);
    expect(builderFor(sections, findNode(sections, 't')!)).toMatchObject({
      ok: true,
      project: { id: 'website' },
      routine: { id: 'trig_projects', token: 'projects-token' },
    });

    const sent = await handStepToClaude({ supabase, userId: 'u', id: 't' });
    expect(sent).toMatchObject({ ok: true, outline: '2000.1' });
    expect(routines.at(-1)).toEqual({ id: 'trig_projects', token: 'projects-token' });
    expect(started[0]).toContain('call add_repo for knightx4/selveyknightwebsite with push access');
    expect(started[0]).toContain('register_repo_root');
    expect(started[0]).toContain("this checkout's scripts/plan.ts");
    expect(started[0]).toContain('.claude/skills/plan/reference/project-routine.md');
    expect(started[0]).toMatch(/Build plan step #2000\.1, "Site step"/);
    vi.unstubAllEnvs();
  });

  it("names a project's check command for the session to run before it merges", async () => {
    vi.stubEnv('CLAUDE_PROJECTS_ROUTINE_ID', 'trig_projects');
    vi.stubEnv('CLAUDE_PROJECTS_ROUTINE_TOKEN', 'projects-token');
    const checked = [{ ...PROJECT_FIXTURES[0], routineEnv: null, checkCommand: 'npm test' }];
    plan.data = { items: site, dependencies: [], projects: checked };
    await handStepToClaude({ supabase, userId: 'u', id: 't' });
    expect(started[0]).toContain('run `npm test` in that repository');
    vi.unstubAllEnvs();
  });

  it("keeps the website's own routine and its old preamble while that routine is set", async () => {
    vi.stubEnv('CLAUDE_PROJECTS_ROUTINE_ID', 'trig_projects');
    vi.stubEnv('CLAUDE_PROJECTS_ROUTINE_TOKEN', 'projects-token');
    vi.stubEnv('CLAUDE_WEBSITE_ROUTINE_ID', 'trig_site');
    vi.stubEnv('CLAUDE_WEBSITE_ROUTINE_TOKEN', 'site-token');
    plan.data = { items: site, dependencies: [], projects: PROJECT_FIXTURES };
    await handStepToClaude({ supabase, userId: 'u', id: 't' });
    expect(routines.at(-1)).toEqual({ id: 'trig_site', token: 'site-token' });
    expect(started[0]).toContain('Work in that repository');
    expect(started[0]).not.toContain('add_repo');
    vi.unstubAllEnvs();
  });

  it('refuses a project when neither its own routine nor the shared one is set', () => {
    vi.stubEnv('CLAUDE_PROJECTS_ROUTINE_ID', '');
    vi.stubEnv('CLAUDE_PROJECTS_ROUTINE_TOKEN', '');
    vi.stubEnv('CLAUDE_WEBSITE_ROUTINE_ID', '');
    const sections = buildPlanTree({ items: site, dependencies: [], projects: PROJECT_FIXTURES });
    expect(builderFor(sections, findNode(sections, 't')!)).toEqual({
      ok: false,
      error:
        'selveyknight.com has no routine to build it yet: ' +
        'set CLAUDE_PROJECTS_ROUTINE_ID and CLAUDE_PROJECTS_ROUTINE_TOKEN.',
    });
    vi.unstubAllEnvs();
  });

  it('refuses a project row whose project was not loaded, rather than build it here', () => {
    const sections = buildPlanTree({ items: site, dependencies: [] });
    expect(builderFor(sections, findNode(sections, 't')!)).toEqual({
      ok: false,
      error: 'There is no project "website" to build this in.',
    });
  });
});

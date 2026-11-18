import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import { PROJECT_WRITE_TOOLS } from './project-writes';
import type { DashWriteContext } from './registry';

/**
 * Ask Dash adds a repository as a project by name (plan #2553.5): "add my
 * recipes repo" is matched against the repositories GitHub lists, and the
 * row is written through addDevProject as the Projects page writes it.
 */

const ME = '00000000-0000-4000-8000-0000000000aa';
const tool = PROJECT_WRITE_TOOLS.find((t) => t.name === 'add_project')!;

const REPOS = [
  { name: 'recipes', owner: { login: 'example-owner' }, pushed_at: '2026-10-20T00:00:00Z', default_branch: 'main' },
  { name: 'pointtracker', owner: { login: 'example-owner' }, pushed_at: '2026-01-13T00:00:00Z' },
];

let tables: FakeTables;

function ctx(): DashWriteContext {
  return { userId: ME, db: async (schema: string) => fakeSchemaDb(tables)(schema) } as unknown as DashWriteContext;
}

beforeEach(() => {
  tables = { 'public.dev_projects': [] };
  vi.stubEnv('GITHUB_READ_TOKEN', 'test-token');
  vi.stubGlobal('fetch', async (url: string | URL) => {
    const path = String(url).replace('https://api.github.com', '');
    if (path.startsWith('/user/repos')) return new Response(JSON.stringify(REPOS));
    const one = REPOS.find((repo) => path === `/repos/example-owner/${repo.name}`);
    return one ? new Response(JSON.stringify(one)) : new Response('{}', { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('add_project', () => {
  it('adds a repository named by its name alone', async () => {
    const result = await tool.apply(ctx(), { repository: 'recipes' });
    expect(result).toMatchObject({ ok: true, kind: 'add_project', op: 'insert', subjectRef: 'public.dev_projects:recipes' });
    expect(tables['public.dev_projects']).toEqual([
      expect.objectContaining({ id: 'recipes', user_id: ME, owner: 'example-owner', repo: 'recipes' }),
    ]);
  });

  it('writes the set-up step with it and is undone by archiving (plan #2553.6)', async () => {
    const result = await tool.apply(ctx(), { repository: 'recipes' });
    expect(result).toMatchObject({ ok: true, undo: { archive_project: true } });
    if (result.ok) expect(result.summary).toMatch(/under Set up/);
    expect(tables['public.plan_items'].map((row) => row.title)).toEqual([
      'Set up',
      'Make example-owner/recipes ready for Dash to build in',
    ]);
  });

  it('refuses a name GitHub does not list, and adds nothing', async () => {
    const result = await tool.apply(ctx(), { repository: 'nothing-here' });
    expect(result.ok).toBe(false);
    expect(tables['public.dev_projects']).toEqual([]);
  });

  it('puts back an archived project as an update', async () => {
    tables['public.dev_projects'] = [
      { id: 'recipes', user_id: ME, label: 'recipes', owner: 'example-owner', repo: 'recipes', archived_at: '2026-10-01T00:00:00Z' },
    ];
    const result = await tool.apply(ctx(), { repository: 'example-owner/recipes' });
    expect(result).toMatchObject({ ok: true, op: 'update' });
    expect(tables['public.dev_projects'][0].archived_at).toBeNull();
  });
});

/** A detail long enough to pass MIN_DETAIL. */
const FULL =
  'It runs all day now, not only overnight, so it belongs on Home under the strip. Rename it Runner, keep its controls, ' +
  'and drop the Overnight card from Dev settings. Done when Home shows it and settings links there instead.';

describe('add_plan_step', () => {
  const step = PROJECT_WRITE_TOOLS.find((t) => t.name === 'add_plan_step')!;

  it('writes a proposed step at the top of the named workspace, saying how much detail went in', async () => {
    tables['public.plan_items'] = [];
    const result = await step.apply(ctx(), { title: 'Move the Overnight panel to Home', detail: FULL, module: 'dev' });
    expect(result).toMatchObject({ ok: true, kind: 'add_plan_step', op: 'insert' });
    if (result.ok) expect(result.summary).toContain(`with a detail of ${FULL.length} characters`);
    expect(tables['public.plan_items']).toEqual([
      expect.objectContaining({ user_id: ME, title: 'Move the Overnight panel to Home', status: 'proposed', module: 'dev', parent_id: null }),
    ]);
  });

  it('refuses a title alone or a thin detail, writes nothing, and keeps a slip (plan #2999)', async () => {
    tables['public.plan_items'] = [];
    tables['core.dash_slips'] = [];
    const where = { surface: 'people' as const, conversation: 'people:c1', href: '/chat/people/builder' };
    const bare = await step.apply({ ...ctx(), slipWhere: where }, { title: 'Show Google Places on the map', module: 'dev' });
    expect(bare).toMatchObject({ ok: false, error: expect.stringMatching(/Call add_plan_step again now, in this same turn/) });
    const thin = await step.apply({ ...ctx(), slipWhere: where }, { title: 'Show Google Places on the map', detail: 'Use the API.' });
    expect(thin.ok).toBe(false);
    expect(tables['public.plan_items']).toEqual([]);
    expect(tables['core.dash_slips']).toEqual([
      expect.objectContaining({ user_id: ME, kind: 'thin_step', surface: 'people', tool: 'add_plan_step', conversation: 'people:c1', href: '/chat/people/builder' }),
      expect.objectContaining({ kind: 'thin_step', what: expect.stringContaining('12 characters') }),
    ]);
  });

  it('refuses a repeat of a step added in the last half hour, naming it, and keeps a slip (plan #2999)', async () => {
    const now = Date.parse('2026-11-05T12:00:00Z');
    tables['core.dash_slips'] = [];
    tables['public.plan_items'] = [
      { id: 'p1', user_id: ME, number: 2984, title: 'Show Google Places on the map', status: 'proposed', created_at: '2026-11-05T11:50:00Z' },
    ];
    const again = await step.apply({ ...ctx(), now }, { title: 'Show Google Places on the map.', detail: FULL });
    expect(again).toMatchObject({ ok: false, error: expect.stringContaining('#2984') });
    expect(tables['public.plan_items']).toHaveLength(1);
    expect(tables['core.dash_slips']).toEqual([expect.objectContaining({ kind: 'repeated_step' })]);
  });

  it('adds a step whose earlier twin is older than half an hour or was dropped', async () => {
    const now = Date.parse('2026-11-05T12:00:00Z');
    tables['public.plan_items'] = [
      { id: 'p1', user_id: ME, number: 2984, title: 'Show Google Places on the map', status: 'proposed', created_at: '2026-11-05T11:00:00Z' },
      { id: 'p2', user_id: ME, number: 2985, title: 'Show Google Places on the map', status: 'dropped', created_at: '2026-11-05T11:55:00Z' },
    ];
    const result = await step.apply({ ...ctx(), now }, { title: 'Show Google Places on the map', detail: FULL });
    expect(result.ok).toBe(true);
  });

  it('refuses an unknown workspace and a missing title, writing nothing', async () => {
    tables['public.plan_items'] = [];
    expect((await step.apply(ctx(), { title: 'x', module: 'cooking' })).ok).toBe(false);
    expect((await step.apply(ctx(), { title: ' ' })).ok).toBe(false);
    expect(tables['public.plan_items']).toEqual([]);
  });

  it('refuses a step that asks them to decide, since that is a question for the chat', async () => {
    tables['public.plan_items'] = [];
    const result = await step.apply(ctx(), { title: 'Decide how Ask Dash reaches the studio', module: 'dev' });
    expect(result.ok).toBe(false);
    expect(tables['public.plan_items']).toEqual([]);
  });

  it('hangs under a numbered step and takes its workspace', async () => {
    tables['public.plan_items'] = [{ id: 'p1', user_id: ME, number: 2483, module: 'jobs', position: 10 }];
    await step.apply(ctx(), { title: 'Child', under: '#2483', detail: FULL });
    const child = tables['public.plan_items'].find((row) => row.title === 'Child');
    expect(child).toMatchObject({ parent_id: 'p1', module: 'jobs', status: 'proposed' });
  });

  describe('files it under the project it belongs to (plan #3095)', () => {
    const MUSIC = {
      id: 'music-pipeline',
      user_id: ME,
      label: 'music-pipeline',
      owner: 'example-owner',
      repo: 'music-pipeline',
      bot_id: 'bot-maemae',
      created_at: '2026-10-01T00:00:00Z',
    };
    const MUSIC_DETAIL = `Repository: example-owner/music-pipeline, studio timeline. ${FULL}`;

    beforeEach(() => {
      tables['public.dev_projects'] = [MUSIC];
      tables['public.plan_items'] = [];
    });

    it('lands under the project its detail names as the repository', async () => {
      const result = await step.apply(ctx(), { title: 'Make linked copies reachable', detail: MUSIC_DETAIL });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.summary).toContain('in the music-pipeline project');
      expect(tables['public.plan_items']).toEqual([
        expect.objectContaining({ module: 'music-pipeline', parent_id: null, status: 'proposed' }),
      ]);
    });

    it('stays under the app as a whole when no repository is named', async () => {
      await step.apply(ctx(), { title: 'Move the Overnight panel to Home', detail: FULL });
      expect(tables['public.plan_items']).toEqual([expect.objectContaining({ module: null })]);
    });

    it('takes a project named outright, and refuses one that is not a project', async () => {
      await step.apply(ctx(), { title: 'Studio tweak', detail: FULL, project: 'music-pipeline' });
      expect(tables['public.plan_items']).toEqual([expect.objectContaining({ module: 'music-pipeline' })]);
      const wrong = await step.apply(ctx(), { title: 'Other tweak', detail: FULL, project: 'cooking' });
      expect(wrong).toMatchObject({ ok: false, error: expect.stringContaining('music-pipeline') });
    });

    it('lands under the project of a bot that passed it on', async () => {
      await step.apply({ ...ctx(), bots: ['bot-bob', 'bot-maemae'] }, { title: 'Studio fix', detail: FULL });
      expect(tables['public.plan_items']).toEqual([expect.objectContaining({ module: 'music-pipeline' })]);
    });

    it('keeps a child under its parent project', async () => {
      tables['public.plan_items'] = [{ id: 'p1', user_id: ME, number: 3064, module: 'music-pipeline', position: 10 }];
      await step.apply(ctx(), { title: 'Child', under: '#3064', detail: FULL });
      expect(tables['public.plan_items'].find((row) => row.title === 'Child')).toMatchObject({
        parent_id: 'p1',
        module: 'music-pipeline',
      });
    });

    it('flags a repository that is not a project and leaves the step where it was', async () => {
      const result = await step.apply(ctx(), {
        title: 'Fix the recipe import',
        detail: `Repository: example-owner/recipes. ${FULL}`,
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.summary).toContain('example-owner/recipes');
      expect(tables['public.plan_items']).toEqual([
        expect.objectContaining({ module: null, comment: expect.stringContaining('not one of the projects in Dev') }),
      ]);
    });
  });
});

describe('add_plan_step instructions', () => {
  const step = PROJECT_WRITE_TOOLS.find((t) => t.name === 'add_plan_step')!;
  it('asks for everything worked out in the conversation, not only what was typed', () => {
    expect(step.definition.description).toMatch(/worked out in that conversation goes into the detail/);
    const detail = (step.definition.input_schema as { properties: { detail: { description: string } } }).properties.detail;
    expect(detail.description).toMatch(/whole conversation/);
  });

  it('requires the detail (plan #2999)', () => {
    expect((step.definition.input_schema as unknown as { required: string[] }).required).toEqual(['title', 'detail']);
  });
});

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
  { name: 'recipes', owner: { login: 'knightx4' }, pushed_at: '2026-10-20T00:00:00Z', default_branch: 'main' },
  { name: 'pointtracker', owner: { login: 'knightx4' }, pushed_at: '2026-01-13T00:00:00Z' },
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
    const one = REPOS.find((repo) => path === `/repos/knightx4/${repo.name}`);
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
      expect.objectContaining({ id: 'recipes', user_id: ME, owner: 'knightx4', repo: 'recipes' }),
    ]);
  });

  it('refuses a name GitHub does not list, and adds nothing', async () => {
    const result = await tool.apply(ctx(), { repository: 'nothing-here' });
    expect(result.ok).toBe(false);
    expect(tables['public.dev_projects']).toEqual([]);
  });

  it('puts back an archived project as an update', async () => {
    tables['public.dev_projects'] = [
      { id: 'recipes', user_id: ME, label: 'recipes', owner: 'knightx4', repo: 'recipes', archived_at: '2026-10-01T00:00:00Z' },
    ];
    const result = await tool.apply(ctx(), { repository: 'knightx4/recipes' });
    expect(result).toMatchObject({ ok: true, op: 'update' });
    expect(tables['public.dev_projects'][0].archived_at).toBeNull();
  });
});

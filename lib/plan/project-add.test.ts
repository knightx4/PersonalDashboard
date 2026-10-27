import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import {
  addDevProject,
  archiveDevProject,
  listGithubRepositories,
  parseRepositoryName,
  projectIdFor,
  projectRowFor,
  repositoryByName,
  tokenTooNarrow,
  type GithubRepository,
} from './project-add';

const ME = '00000000-0000-4000-8000-0000000000aa';

function repo(over: Partial<GithubRepository> & { name: string }): GithubRepository {
  return {
    owner: 'knightx4',
    fullName: `knightx4/${over.name}`,
    description: null,
    homepage: null,
    defaultBranch: 'main',
    pushedAt: null,
    private: false,
    ...over,
  };
}

/** A fetch that answers each path with the JSON given, and 404 for anything else. */
function github(answers: Record<string, unknown>): typeof globalThis.fetch {
  return (async (url: string | URL) => {
    const path = String(url).replace('https://api.github.com', '');
    const key = Object.keys(answers).find((prefix) => path.startsWith(prefix));
    if (!key) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(answers[key]), { status: 200 });
  }) as typeof globalThis.fetch;
}

function db(tables: FakeTables) {
  return fakeSchemaDb(tables)('public') as unknown as SupabaseClient;
}

describe('parseRepositoryName', () => {
  it('reads owner/name, a link and a clone address', () => {
    expect(parseRepositoryName('knightx4/recipes')).toEqual({ owner: 'knightx4', repo: 'recipes' });
    expect(parseRepositoryName('https://github.com/knightx4/recipes/')).toEqual({ owner: 'knightx4', repo: 'recipes' });
    expect(parseRepositoryName('git@github.com:knightx4/recipes.git')).toEqual({ owner: 'knightx4', repo: 'recipes' });
  });

  it('refuses a bare name and anything with more parts', () => {
    expect(parseRepositoryName('recipes')).toBeNull();
    expect(parseRepositoryName('a/b/c')).toBeNull();
    expect(parseRepositoryName('-bad/recipes')).toBeNull();
  });
});

describe('projectIdFor', () => {
  it('slugifies the name under 40 characters', () => {
    expect(projectIdFor('My_Recipes.App', [])).toBe('my-recipes-app');
    expect(projectIdFor('x'.repeat(60), []).length).toBe(40);
    expect(projectIdFor('2048', [])).toBe('project-2048');
  });

  it('never takes a workspace id or one already used', () => {
    expect(projectIdFor('jobs', [])).toBe('jobs-2');
    expect(projectIdFor('recipes', ['recipes', 'recipes-2'])).toBe('recipes-3');
  });
});

describe('the listing', () => {
  it('lists newest pushed first and leaves archived repositories out', async () => {
    const listing = await listGithubRepositories({
      token: 't',
      fetch: github({
        '/user/repos': [
          { name: 'old', owner: { login: 'knightx4' }, pushed_at: '2025-01-01T00:00:00Z' },
          { name: 'new', owner: { login: 'knightx4' }, pushed_at: '2026-10-01T00:00:00Z', private: true },
          { name: 'gone', owner: { login: 'knightx4' }, archived: true },
        ],
      }),
    });
    expect(listing.error).toBeNull();
    expect(listing.repositories.map((r) => r.name)).toEqual(['new', 'old']);
    expect(listing.repositories[0].private).toBe(true);
  });

  it('says so when the token is missing or refused', async () => {
    expect((await listGithubRepositories({ token: null })).error).toMatch(/No GITHUB_READ_TOKEN/);
    const refused = await listGithubRepositories({ token: 't', fetch: github({}) });
    expect(refused.repositories).toEqual([]);
    expect(refused.error).toMatch(/GITHUB_READ_TOKEN/);
  });

  it('calls a token that sees only this repository too narrow', () => {
    expect(tokenTooNarrow([repo({ name: 'PersonalDashboard' })])).toBe(true);
    expect(tokenTooNarrow([])).toBe(true);
    expect(tokenTooNarrow([repo({ name: 'PersonalDashboard' }), repo({ name: 'recipes' })])).toBe(false);
  });
});

describe('repositoryByName', () => {
  const listed = [repo({ name: 'recipes' }), repo({ name: 'recipes-old' }), repo({ name: 'pointtracker' })];

  it('takes an exact name before a partial one', () => {
    expect(repositoryByName('recipes', listed)).toEqual({ owner: 'knightx4', repo: 'recipes' });
    expect(repositoryByName('point', listed)).toEqual({ owner: 'knightx4', repo: 'pointtracker' });
  });

  it('refuses a name that matches several or none', () => {
    expect(repositoryByName('recip', listed)).toHaveProperty('error');
    expect(repositoryByName('nothing', listed)).toHaveProperty('error');
  });
});

describe('addDevProject', () => {
  const recipes = {
    name: 'recipes',
    owner: { login: 'knightx4' },
    description: 'Things to cook',
    homepage: 'https://recipes.example.com',
    default_branch: 'trunk',
  };

  it('reads the repository and writes the row', async () => {
    const tables: FakeTables = { 'public.dev_projects': [] };
    const result = await addDevProject({
      db: db(tables),
      userId: ME,
      repository: { owner: 'knightx4', repo: 'recipes' },
      token: 't',
      fetch: github({ '/repos/knightx4/recipes': recipes }),
    });
    expect(result.ok).toBe(true);
    expect(tables['public.dev_projects']).toHaveLength(1);
    expect(tables['public.dev_projects'][0]).toMatchObject({
      id: 'recipes',
      user_id: ME,
      label: 'recipes',
      description: 'Things to cook',
      branch: 'trunk',
      url: 'https://recipes.example.com',
    });
  });

  it('refuses one already added, and this app', async () => {
    const tables: FakeTables = {
      'public.dev_projects': [{ id: 'recipes', user_id: ME, label: 'recipes', owner: 'knightx4', repo: 'Recipes' }],
    };
    const again = await addDevProject({
      db: db(tables),
      userId: ME,
      repository: { owner: 'knightx4', repo: 'recipes' },
      token: 't',
      fetch: github({ '/repos/knightx4/recipes': recipes }),
    });
    expect(again).toMatchObject({ ok: false });
    const self = await addDevProject({
      db: db(tables),
      userId: ME,
      repository: { owner: 'knightx4', repo: 'PersonalDashboard' },
      token: 't',
    });
    expect(self).toMatchObject({ ok: false });
  });

  it('puts an archived one back', async () => {
    const tables: FakeTables = {
      'public.dev_projects': [
        { id: 'recipes', user_id: ME, label: 'recipes', owner: 'knightx4', repo: 'recipes', archived_at: '2026-10-01T00:00:00Z' },
      ],
    };
    const result = await addDevProject({
      db: db(tables),
      userId: ME,
      repository: { owner: 'knightx4', repo: 'recipes' },
      token: 't',
    });
    expect(result).toMatchObject({ ok: true, restored: true });
    expect(tables['public.dev_projects'][0].archived_at).toBeNull();
  });

  it('says GitHub refused when it would not show the repository', async () => {
    const result = await addDevProject({
      db: db({ 'public.dev_projects': [] }),
      userId: ME,
      repository: { owner: 'knightx4', repo: 'secret' },
      token: 't',
      fetch: github({}),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/GitHub would not show knightx4\/secret/);
  });
});

describe('archiveDevProject', () => {
  it('sets archived_at and refuses one already archived', async () => {
    const tables: FakeTables = {
      'public.dev_projects': [{ id: 'recipes', user_id: ME, label: 'recipes', owner: 'k', repo: 'r', archived_at: null }],
    };
    expect(await archiveDevProject({ db: db(tables), userId: ME, id: 'recipes' })).toEqual({ ok: true, label: 'recipes' });
    expect(tables['public.dev_projects'][0].archived_at).toEqual(expect.any(String));
    expect(await archiveDevProject({ db: db(tables), userId: ME, id: 'recipes' })).toMatchObject({ ok: false });
  });
});

describe('projectRowFor', () => {
  it('keeps the description within the column and drops a homepage that is not a link', () => {
    const row = projectRowFor({
      userId: ME,
      id: 'x',
      repository: repo({ name: 'x', description: 'd'.repeat(300), homepage: 'example.com' }),
    });
    expect(String(row.description).length).toBe(200);
    expect(row.url).toBeNull();
  });
});

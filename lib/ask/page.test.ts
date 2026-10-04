import { describe, expect, it } from 'vitest';
import type { ModuleId } from '@/lib/modules';
import { SOURCES } from '@/lib/sources/catalogue';
import { noteHref } from '@/lib/vault/paths';
import type { AskContext, AskDb, AskSchema, SchemaClient } from './db';
import { OPENABLE } from './lookups';
import { matchPage, pathOf, patternOf, resolvePage, ROW_PATTERNS } from './page';

/**
 * Reading a page address back into the row it shows (plan #1270). The
 * matcher runs on the catalogue's real href functions, so a source that
 * gains a per-row page is covered without this file changing.
 */

const ME = '00000000-0000-4000-8000-00000000000a';
const THEM = '00000000-0000-4000-8000-00000000000b';
const ROLE = '11111111-1111-4111-8111-111111111111';
const GOAL = '22222222-2222-4222-8222-222222222222';
const THEIR_GOAL = '33333333-3333-4333-8333-333333333333';

describe('matchPage', () => {
  it('reads a vault note by its path, slashes and spaces included', () => {
    const path = 'Projects/Job hunt/Plan & notes.md';
    expect(matchPage(noteHref(path))).toEqual({
      path: noteHref(path),
      module: 'vault',
      page: 'Vault note',
      row: { table: 'obsidian.notes', ref: path },
    });
  });

  it('reads a role by its id', () => {
    const match = matchPage(`/jobs/roles/${ROLE}?tab=notes#top`);
    expect(match.row).toEqual({ table: 'job_search.roles', ref: ROLE });
    expect(match.page).toBe('Job search role');
    expect(match.path).toBe(`/jobs/roles/${ROLE}`);
  });

  it('reads a company by its slug, decoded', () => {
    expect(matchPage('/jobs/companies/acme%20%26%20co').row).toEqual({
      table: 'job_search.companies',
      ref: 'acme & co',
    });
  });

  it('reads a goal, which the catalogue does not link, and no area, which has no page', () => {
    expect(matchPage(`/goals/${GOAL}`).row).toEqual({ table: 'goals.items', ref: GOAL });
    expect(matchPage(`/goals/area/${GOAL}`).row).toBeNull();
    expect(matchPage(`/goals/${GOAL}`).page).toBe('Goals goal');
  });

  it('gives only the page for a list page and for pages that are not ids', () => {
    expect(matchPage('/jobs/pipeline')).toEqual({
      path: '/jobs/pipeline',
      module: 'jobs',
      page: 'Job search: pipeline',
      row: null,
    });
    // `all` sits where a goal id would; an id column only takes a uuid.
    expect(matchPage('/goals/all').row).toBeNull();
    expect(matchPage('/goals/all').page).toBe('Goals: all');
    expect(matchPage('/todo/').page).toBe('Todo');
    // A page beneath a row's page is not that row.
    expect(matchPage(`/jobs/roles/${ROLE}/edit`).row).toBeNull();
  });

  it('gives a name to an address it does not know', () => {
    expect(matchPage('/nowhere/at-all')).toEqual({
      path: '/nowhere/at-all',
      module: null,
      page: 'Nowhere at all',
      row: null,
    });
    expect(matchPage('/').page).toBe('Home');
    expect(matchPage('https://dash.example.com/account?x=1').path).toBe('/account');
  });

  it('has a pattern for every openable source whose page shows one row', () => {
    for (const source of OPENABLE) {
      const pattern = patternOf(source.table, source.href!, source.ref ?? 'id');
      if (!pattern) continue;
      const ref = pattern.uuid ? ROLE : 'some-ref';
      expect(matchPage(source.href!(ref)).row, source.table).toEqual({ table: source.table, ref });
    }
    expect(ROW_PATTERNS.length).toBeGreaterThan(10);
  });

  it('finds no pattern in an href that ignores its ref', () => {
    const tasks = SOURCES.find((s) => s.table === 'todo.tasks')!;
    expect(patternOf(tasks.table, tasks.href!)).toBeNull();
  });

  it('finds no pattern in an href whose ref is only in the fragment', () => {
    const courses = SOURCES.find((s) => s.table === 'obsidian.courses')!;
    expect(patternOf(courses.table, courses.href!)).toBeNull();
    expect(matchPage('/vault/education#course-abc').row).toBeNull();
  });

  it('keeps the query and fragment off the path', () => {
    expect(pathOf('/learn/now?x=1#y')).toBe('/learn/now');
  });
});

// ---------------------------------------------------------------------------
// resolvePage: the title, read as the asker
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

class FakeQuery implements PromiseLike<{ data: Row[]; error: null }> {
  private filters: ((row: Row) => boolean)[] = [];
  constructor(private readonly rows: Row[]) {}
  select() {
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  limit() {
    return this;
  }
  then<A = { data: Row[]; error: null }, B = never>(
    onFulfilled?: ((value: { data: Row[]; error: null }) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    const data = this.rows.filter((row) => this.filters.every((f) => f(row)));
    return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected);
  }
}

const TABLES: Record<string, Row[]> = {
  'job_search.roles': [{ id: ROLE, user_id: ME, title: 'Staff engineer' }],
  'goals.items': [
    { id: GOAL, user_id: ME, title: 'Run a marathon' },
    { id: THEIR_GOAL, user_id: THEM, title: 'Their goal' },
  ],
};

const db: AskDb = async (schema: AskSchema) =>
  ({ from: (table: string) => new FakeQuery(TABLES[`${schema}.${table}`] ?? []) }) as unknown as SchemaClient;

function context(enabledModules: ModuleId[] = ['jobs', 'goals', 'vault']): AskContext {
  return { userId: ME, today: '2026-09-30', enabledModules, db, searchSources: [] };
}

describe('resolvePage', () => {
  it('reads the title of the row a page shows', async () => {
    expect((await resolvePage(context(), `/jobs/roles/${ROLE}`)).row).toEqual({
      table: 'job_search.roles',
      ref: ROLE,
      title: 'Staff engineer',
      href: `/jobs/roles/${ROLE}`,
    });
    expect((await resolvePage(context(), `/goals/${GOAL}`)).row?.title).toBe('Run a marathon');
  });

  it("gives the page without a row for another person's id", async () => {
    const page = await resolvePage(context(), `/goals/${THEIR_GOAL}`);
    expect(page).toEqual({ path: `/goals/${THEIR_GOAL}`, module: 'goals', page: 'Goals goal', row: null });
  });

  it('gives the page without a row in a workspace that is off', async () => {
    expect((await resolvePage(context(['goals']), `/jobs/roles/${ROLE}`)).row).toBeNull();
    expect((await resolvePage(context(['jobs']), `/goals/${GOAL}`)).row).toBeNull();
  });

  it('reads nothing for a list page', async () => {
    expect(await resolvePage(context(), '/jobs/pipeline')).toEqual({
      path: '/jobs/pipeline',
      module: 'jobs',
      page: 'Job search: pipeline',
      row: null,
    });
  });
});

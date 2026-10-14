import { describe, expect, it, vi } from 'vitest';
import { PAGES, pageFor } from '@/lib/sources/catalogue';
import {
  HOME_CRUMB,
  NO_LONGER_THERE,
  parseRef,
  refHref,
  refPath,
  refPaths,
  refTitles,
  toRef,
  type ReadRows,
} from './refs';

const ID = '1fc661a1-c4da-4e07-8fb4-82b256db5611';
const OTHER = '04bd04f4-f6d4-4737-b3b5-492a99eda54e';

describe('parseRef', () => {
  it('splits schema.table:id', () => {
    expect(parseRef(`goals.items:${ID}`)).toEqual({ table: 'goals.items', schema: 'goals', name: 'items', id: ID });
  });

  it('keeps a colon inside the id', () => {
    expect(parseRef('public.orders:a:b')?.id).toBe('a:b');
  });

  it('refuses what is not a ref', () => {
    for (const bad of ['', 'goals.items', 'items:1', 'goals.items:', 'Goals.Items:1', 'a.b.c:1']) {
      expect(parseRef(bad), bad).toBeNull();
    }
  });

  it('reads the refs core.files.origin and observation evidence already hold', () => {
    expect(parseRef(`job_search.interviews:${ID}`)?.table).toBe('job_search.interviews');
    expect(toRef('todo.tasks', ID)).toBe(`todo.tasks:${ID}`);
  });
});

describe('the registry', () => {
  it('names each table once', () => {
    const tables = PAGES.map((p) => p.table);
    expect(tables.filter((t, i) => tables.indexOf(t) !== i)).toEqual([]);
  });

  it('covers tables Goals does not read as well as sources', () => {
    expect(pageFor('public.plan_items')).not.toBeNull();
    expect(pageFor('public.orders')).not.toBeNull();
    expect(pageFor('job_search.roles')).not.toBeNull();
    expect(pageFor('news.preferences')).toBeNull();
    expect(pageFor('public.merchants')).toBeNull();
  });
});

describe('refHref', () => {
  it('gives the page straight from the id where it can', () => {
    expect(refHref(`public.orders:${ID}`)).toBe(`/shopping/orders/${ID}`);
    expect(refHref(`job_search.roles:${ID}`)).toBe(`/jobs/roles/${ID}`);
    expect(refHref(`todo.tasks:${ID}`)).toBe(`/todo/all?status=all&focus=${ID}`);
  });

  it('goes through /open where the page needs another column', () => {
    expect(refHref(`public.plan_items:${ID}`)).toBe(`/open/${encodeURIComponent(`public.plan_items:${ID}`)}`);
    expect(refHref(`obsidian.notes:${ID}`)).toMatch(/^\/open\//);
  });

  it('is null for a table with no page or a malformed ref', () => {
    expect(refHref(`public.merchants:${ID}`)).toBeNull();
    expect(refHref('nothing')).toBeNull();
  });
});

describe('refTitles', () => {
  it('reads each table once and names each row with its page', async () => {
    const read = vi.fn<ReadRows>(async (table, _columns, ids) => {
      if (table === 'public.plan_items') return ids.map((id) => ({ id, title: 'Give rows a ref', number: 1449 }));
      if (table === 'goals.items') {
        return ids.map((id) =>
          id === ID
            ? { id, title: 'Run a marathon', level: 'goal', parent_id: null }
            : { id, title: 'Buy shoes', level: 'step', parent_id: ID },
        );
      }
      return [];
    });

    const refs = [`public.plan_items:${ID}`, `goals.items:${ID}`, `goals.items:${OTHER}`];
    const out = await refTitles(refs, read);

    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls.find(([t]) => t === 'goals.items')?.[2]).toEqual([ID, OTHER]);
    expect(read.mock.calls.find(([t]) => t === 'public.plan_items')?.[1]).toEqual(['id', 'title', 'number', 'parent_id']);
    expect(out.get(refs[0])).toMatchObject({
      missing: false,
      title: 'Give rows a ref',
      href: '/dev/plan/1449',
    });
    expect(out.get(refs[1])).toMatchObject({ title: 'Run a marathon', href: `/goals/${ID}` });
    expect(out.get(refs[2])).toMatchObject({ title: 'Buy shoes', href: `/goals/${ID}/s/${OTHER}` });
  });

  it('answers a gone row, an unknown table and a non-ref as no longer there', async () => {
    const read: ReadRows = async () => [];
    const refs = [`public.orders:${ID}`, `public.merchants:${ID}`, 'not a ref'];
    const out = await refTitles(refs, read);
    for (const ref of refs) {
      expect(out.get(ref), ref).toMatchObject({ missing: true, title: NO_LONGER_THERE, href: null });
    }
    expect(out.get(refs[0])).toMatchObject({ table: 'public.orders', id: ID });
  });

  it('cuts a long title to one short line', async () => {
    const body = `${'word '.repeat(40)}\nsecond line`;
    const out = await refTitles([`public.ideas:${ID}`], async (_t, _c, ids) => ids.map((id) => ({ id, body })));
    const title = out.get(`public.ideas:${ID}`)!.title;
    expect(title.length).toBeLessThanOrEqual(90);
    expect(title.endsWith('…')).toBe(true);
    expect(title).not.toContain('second');
  });

  it('reads nothing for an empty batch', async () => {
    const read = vi.fn<ReadRows>(async () => []);
    expect((await refTitles([], read)).size).toBe(0);
    expect(read).not.toHaveBeenCalled();
  });
});

describe('refPath', () => {
  const AREA = 'a0000000-0000-4000-8000-000000000001';
  const GOAL = 'a0000000-0000-4000-8000-000000000002';
  const STEP = 'a0000000-0000-4000-8000-000000000003';
  const COMPANY = 'a0000000-0000-4000-8000-000000000004';
  const ROLE = 'a0000000-0000-4000-8000-000000000005';
  const APPLICATION = 'a0000000-0000-4000-8000-000000000006';
  const INTERVIEW = 'a0000000-0000-4000-8000-000000000007';
  const ORDER = 'a0000000-0000-4000-8000-000000000008';
  const FEATURE = 'a0000000-0000-4000-8000-000000000009';
  const PLAN_STEP = 'a0000000-0000-4000-8000-00000000000a';
  const FILE = 'a0000000-0000-4000-8000-00000000000b';

  /** The rows a person might have, by table; each read returns those asked for. */
  const ROWS: Record<string, Record<string, Record<string, unknown>>> = {
    'goals.areas': { [AREA]: { name: 'Money' } },
    'goals.items': {
      [GOAL]: { title: 'Pay off the cards', level: 'goal', parent_id: null, area_id: AREA },
      [STEP]: { title: 'Call the bank', level: 'step', parent_id: GOAL, area_id: AREA },
    },
    'job_search.companies': { [COMPANY]: { name: 'Acme', slug: 'acme' } },
    'job_search.roles': { [ROLE]: { title: 'Product designer', company_id: COMPANY } },
    'job_search.applications': { [APPLICATION]: { next_action: 'Follow up', role_id: ROLE } },
    'job_search.interviews': { [INTERVIEW]: { notes: 'Portfolio review', application_id: APPLICATION } },
    'public.orders': { [ORDER]: { external_order_number: '1234', order_date: '2026-10-01' } },
    'public.plan_items': {
      [FEATURE]: { title: 'Every row has a page', number: 1931, parent_id: null },
      [PLAN_STEP]: { title: 'The catalogue knows each row', number: 1932, parent_id: FEATURE },
    },
    'core.files': { [FILE]: { title: 'Bank call script', origin: `goals.items:${STEP}` } },
  };

  function reader() {
    return vi.fn<ReadRows>(async (table, columns, ids) =>
      ids.flatMap((id) => {
        const row = ROWS[table]?.[id];
        if (!row) return [];
        // Only the columns asked for, as the database would answer.
        return [Object.fromEntries(columns.map((c) => [c, c === 'id' ? id : (row[c] ?? null)]))];
      }),
    );
  }

  it('walks a goal step up through its goal and area', async () => {
    expect(await refPath(`goals.items:${STEP}`, reader())).toEqual([
      { label: 'Goals', href: '/goals' },
      { label: 'All goals', href: '/goals/all' },
      { label: 'Money', href: `/goals/area/${AREA}` },
      { label: 'Pay off the cards', href: `/goals/${GOAL}` },
      { label: 'Call the bank', href: `/goals/${GOAL}/s/${STEP}` },
    ]);
  });

  it('names a role under its company', async () => {
    expect(await refPath(`job_search.roles:${ROLE}`, reader())).toEqual([
      { label: 'Job search', href: '/jobs' },
      { label: 'Pipeline', href: '/jobs/pipeline' },
      { label: 'Acme', href: '/jobs/companies/acme' },
      { label: 'Product designer', href: `/jobs/roles/${ROLE}` },
    ]);
  });

  it('walks past the application between an interview and its role', async () => {
    const path = await refPath(`job_search.interviews:${INTERVIEW}`, reader());
    expect(path.map((c) => c.label)).toEqual(['Job search', 'Pipeline', 'Acme', 'Product designer', 'Portfolio review']);
  });

  it('gives an order, which sits under nothing, its workspace and section alone', async () => {
    expect(await refPath(`public.orders:${ORDER}`, reader())).toEqual([
      { label: 'Shopping', href: '/shopping/dashboard' },
      { label: 'Orders', href: '/shopping/orders' },
      { label: 'Order 1234', href: `/shopping/orders/${ORDER}` },
    ]);
  });

  it('names a plan step under its feature', async () => {
    expect(await refPath(`public.plan_items:${PLAN_STEP}`, reader())).toEqual([
      { label: 'Dev', href: '/dev/raised' },
      { label: 'Plan', href: '/dev/plan' },
      { label: 'Every row has a page', href: '/dev/plan/1931' },
      { label: 'The catalogue knows each row', href: '/dev/plan/1932' },
    ]);
  });

  it('puts a row with no section of its own in the section of the row above it', async () => {
    const path = await refPath(`core.files:${FILE}`, reader());
    expect(path.map((c) => c.label)).toEqual([
      'Goals',
      'All goals',
      'Money',
      'Pay off the cards',
      'Call the bank',
      'Bank call script',
    ]);
  });

  it('reads each table once per level, however many rows share it', async () => {
    const read = reader();
    const paths = await refPaths([`goals.items:${STEP}`, `goals.items:${GOAL}`, `job_search.roles:${ROLE}`], read);
    expect(paths.get(`goals.items:${GOAL}`)?.map((c) => c.label)).toEqual(['Goals', 'All goals', 'Money', 'Pay off the cards']);
    // Level one: goals.items and job_search.roles. Level two: goals.items
    // (the step's goal was already read) and goals.areas, companies.
    const calls = read.mock.calls.map(([table]) => table);
    expect(calls.filter((t) => t === 'goals.items')).toHaveLength(1);
    expect(calls.filter((t) => t === 'goals.areas')).toHaveLength(1);
  });

  it('gives a gone row the path to where it was, and a non-ref none', async () => {
    const gone = 'a0000000-0000-4000-8000-0000000000ff';
    expect(await refPath(`public.orders:${gone}`, reader())).toEqual([
      { label: 'Shopping', href: '/shopping/dashboard' },
      { label: 'Orders', href: '/shopping/orders' },
    ]);
    expect(await refPath(`public.merchants:${gone}`, reader())).toEqual([]);
    expect(await refPath('not a ref', reader())).toEqual([]);
  });

  it('ends the path where a row above it has gone', async () => {
    const read = vi.fn<ReadRows>(async (table, _columns, ids) =>
      table === 'job_search.roles'
        ? ids.map((id) => ({ id, title: 'Product designer', company_id: COMPANY }))
        : [],
    );
    expect((await refPath(`job_search.roles:${ROLE}`, read)).map((c) => c.label)).toEqual([
      'Job search',
      'Pipeline',
      'Product designer',
    ]);
  });

  it('starts at Home for a page outside the workspaces, naming it once', async () => {
    const read: ReadRows = async (_t, _c, ids) => ids.map((id) => ({ id, week: '2026-09-27' }));
    expect(await refPath(`core.week_reviews:${ORDER}`, read)).toEqual([
      HOME_CRUMB,
      { label: 'The week of 2026-09-27', href: '/home/week/2026-09-27' },
    ]);
  });
});

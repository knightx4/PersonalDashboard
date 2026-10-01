/**
 * A gaps reading list shown in teaching order (plan #1394).
 *
 * A subject with a chain of four claims, each built on the one before, and a
 * list holding readings for three of them added in the wrong order, plus one
 * you wrote down yourself. The page should put the basics first, run the link
 * through the claim that has no reading, keep your own reading in its slot,
 * and say the list is in teaching order. A list of readings tied to no claim
 * reads exactly as it was added and says nothing.
 *
 * The page reads through a Supabase client. Here that client is a small
 * stand-in that turns the handful of calls loadTrack and loadTracks make into
 * SQL against the test database, narrowed to one person the way RLS would be.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { admin, closeDb, createUser, truncateAll } from './helpers/db-learn';

const state = vi.hoisted(() => ({ userId: '' }));

type Filter = { column: string; op: '=' | 'in'; value: unknown };

/** Just enough of the query builder for the reads this page makes. */
function from(table: string) {
  const filters: Filter[] = [];
  const orders: string[] = [];
  let single = false;

  async function run(): Promise<{ data: unknown; error: null }> {
    const params: unknown[] = [state.userId];
    const where = ['user_id = $1'];
    for (const filter of filters) {
      params.push(filter.value);
      where.push(
        filter.op === 'in'
          ? `${filter.column} = any($${params.length})`
          : `${filter.column} = $${params.length}`,
      );
    }
    const order = orders.length > 0 ? ` order by ${orders.join(', ')}` : '';
    const rows = await admin.unsafe(
      `select * from learn.${table} where ${where.join(' and ')}${order}`,
      params as never[],
    );
    // No reading here has a source; the embed comes back empty.
    const shaped = rows.map((row) => (table === 'readings' ? { ...row, sources: null } : row));
    return { data: single ? (shaped[0] ?? null) : shaped, error: null };
  }

  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => (filters.push({ column, op: '=', value }), builder),
    in: (column: string, value: unknown[]) => (filters.push({ column, op: 'in', value }), builder),
    order: (column: string, options?: { ascending?: boolean }) => (
      orders.push(`${column} ${options?.ascending === false ? 'desc' : 'asc'}`),
      builder
    ),
    maybeSingle: () => ((single = true), builder),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      run().then(resolve, reject),
  };
  return builder;
}

vi.mock('@/lib/learn/auth/server', () => ({ createLearnClient: async () => ({ from }) }));
vi.mock('@/lib/learn/tracks/news-origin', () => ({ loadReadingOrigins: async () => new Map() }));
vi.mock('@/app/learn/t/[id]/actions', () => ({
  addToTrack: async () => ({}),
  removeTrack: async () => {},
  planTrack: async () => ({}),
  confirmPlan: async () => ({}),
  keepAreas: async () => ({}),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found');
  },
}));

const { default: TrackPage } = await import('@/app/learn/t/[id]/page');

const LINE = 'In teaching order';

let gapsTrack = '';
let ownTrack = '';

async function page(id: string): Promise<string> {
  return renderToStaticMarkup(await TrackPage({ params: Promise.resolve({ id }) }));
}

/** Where each title first appears on the page, in the order they appear. */
function order(html: string, titles: string[]): string[] {
  return [...titles].sort((a, b) => html.indexOf(a) - html.indexOf(b));
}

beforeAll(async () => {
  await truncateAll();
  const userId = await createUser('teaching-order@example.com');
  state.userId = userId;

  const [subject] = await admin<{ id: string }[]>`
    insert into subjects (user_id, name) values (${userId}, 'Macroeconomics') returning id`;

  const ids: Record<string, string> = {};
  for (const name of ['Supply and demand', 'Prices', 'Inflation', 'Phillips curve']) {
    const [row] = await admin<{ id: string }[]>`
      insert into concepts (user_id, subject_id, name, claim, basis)
      values (${userId}, ${subject.id}, ${name}, ${name + ' is a claim.'}, 'Seeded by the test.')
      returning id`;
    ids[name] = row.id;
  }
  const chain = ['Supply and demand', 'Prices', 'Inflation', 'Phillips curve'];
  for (let i = 1; i < chain.length; i += 1) {
    await admin`
      insert into concept_edges (user_id, subject_id, prerequisite_id, dependent_id, basis)
      values (${userId}, ${subject.id}, ${ids[chain[i - 1]]}, ${ids[chain[i]]}, 'Seeded by the test.')`;
  }

  const [gaps] = await admin<{ id: string }[]>`
    insert into tracks (user_id, title) values (${userId}, 'Macroeconomics: what you are missing')
    returning id`;
  gapsTrack = gaps.id;

  // Added hardest first, with nothing queued for Prices, which is the link
  // between Supply and demand and Inflation.
  const added: Array<[string, string | null]> = [
    ['Reading on the Phillips curve', ids['Phillips curve']],
    ['A paper I wrote down myself', null],
    ['Reading on inflation', ids['Inflation']],
    ['Reading on supply and demand', ids['Supply and demand']],
  ];
  for (const [index, [title, conceptId]] of added.entries()) {
    await admin`
      insert into readings (user_id, track_id, title, locator_basis, position, concept_id)
      values (${userId}, ${gapsTrack}, ${title}, 'Seeded by the test.', ${index}, ${conceptId})`;
  }

  const [own] = await admin<{ id: string }[]>`
    insert into tracks (user_id, title) values (${userId}, 'Things to read') returning id`;
  ownTrack = own.id;
  for (const [index, title] of ['Zeta first', 'Alpha second'].entries()) {
    await admin`
      insert into readings (user_id, track_id, title, locator_basis, position)
      values (${userId}, ${ownTrack}, ${title}, 'Seeded by the test.', ${index})`;
  }
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('a gaps reading list', () => {
  it('shows the readings with the basics first, and says it is in teaching order', async () => {
    const html = await page(gapsTrack);

    expect(
      order(html, [
        'Reading on the Phillips curve',
        'A paper I wrote down myself',
        'Reading on inflation',
        'Reading on supply and demand',
      ]),
    ).toEqual([
      'Reading on supply and demand',
      'A paper I wrote down myself',
      'Reading on inflation',
      'Reading on the Phillips curve',
    ]);
    expect(html).toContain(LINE);
  });

  it('leaves the stored order alone', async () => {
    const rows = await admin<{ title: string }[]>`
      select title from readings where track_id = ${gapsTrack} order by position`;
    expect(rows.map((row) => row.title)[0]).toBe('Reading on the Phillips curve');
  });
});

describe('a list with no readings tied to claims', () => {
  it('reads in the order it was added and says nothing about teaching order', async () => {
    const html = await page(ownTrack);

    expect(order(html, ['Alpha second', 'Zeta first'])).toEqual(['Zeta first', 'Alpha second']);
    expect(html).not.toContain(LINE);
  });
});

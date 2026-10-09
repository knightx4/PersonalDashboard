import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What a Dev search asks the database for, for the two reads plan #1154 added:
 * the open questions and the raises. A dismissed row of either is one you put
 * aside, so both reads have to leave it out in the query itself -- the rows
 * the stand-in hands back are whatever the filters would have let through.
 */

type Filter = [string, string, unknown];

const filters = new Map<string, Filter[]>();
const rows: Record<string, Record<string, unknown>[]> = {};

function client() {
  return {
    from(table: string) {
      const recorded: Filter[] = [];
      const key = () => {
        const kind = recorded.find(([method, column]) => method === 'eq' && column === 'kind');
        return table === 'plan_items' && kind ? 'questions' : table;
      };
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => (recorded.push(['eq', column, value]), builder),
        neq: (column: string, value: unknown) => (recorded.push(['neq', column, value]), builder),
        is: (column: string, value: unknown) => (recorded.push(['is', column, value]), builder),
        not: (column: string, op: string, value: unknown) =>
          (recorded.push([`not.${op}`, column, value]), builder),
        ilike: (column: string, value: unknown) => (recorded.push(['ilike', column, value]), builder),
        order: () => builder,
        limit: () => {
          filters.set(key(), recorded);
          return Promise.resolve({ data: rows[key()] ?? [], error: null });
        },
      };
      return builder;
    },
  };
}

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/server', () => ({ createClient: async () => client() }));
vi.mock('@/lib/dev/owner', () => ({ isOwner: async () => true }));

const { devSearchSource } = await import('./dev');

beforeEach(() => {
  filters.clear();
  for (const key of Object.keys(rows)) delete rows[key];
});

describe('dev search: questions and raises', () => {
  it('reads only open, undismissed questions and undismissed raises', async () => {
    await devSearchSource.find({ userId: 'u', query: 'token', limit: 10 });

    expect(filters.get('questions')).toEqual(
      expect.arrayContaining([
        ['eq', 'user_id', 'u'],
        ['eq', 'kind', 'decision'],
        ['not.in', 'status', '(done,dropped)'],
        ['is', 'dismissed_at', null],
      ]),
    );
    expect(filters.get('raised_items')).toEqual(
      expect.arrayContaining([
        ['eq', 'user_id', 'u'],
        ['neq', 'status', 'dismissed'],
        ['is', 'goal_id', null],
      ]),
    );
  });

  it('lists a raise found by a word in its ask, linked to its card on the Dash tab', async () => {
    rows.raised_items = [
      { id: 'r1', title: 'Expired', detail: null, ask: 'Renew the token?', status: 'open' },
      { id: 'r2', title: 'Slow page', detail: null, ask: null, status: 'open' },
    ];
    rows.questions = [{ id: 'q1', number: 7, title: 'Which token store?', detail: null }];

    const hits = await devSearchSource.find({ userId: 'u', query: 'token', limit: 10 });
    expect(hits.map((hit) => hit.href)).toEqual([
      '/dev/inbox#waiting-q1',
      '/dev/inbox#raise-r1',
    ]);
  });

  it('lists a workspace vision found by a word only in its text', async () => {
    rows.module_visions = [
      { module: 'jobs', body: 'A calm place to track the search.' },
      { module: 'app', body: 'One dashboard for a whole life.' },
    ];

    const hits = await devSearchSource.find({ userId: 'u', query: 'calm', limit: 10 });
    expect(filters.get('module_visions')).toEqual([['eq', 'user_id', 'u']]);
    expect(hits.map((hit) => hit.href)).toEqual(['/dev/specs#vision-jobs']);
  });
});

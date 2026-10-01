import { describe, expect, it } from 'vitest';
import type { DashChange, NewDashChange } from '@/lib/talk/changes';
import type { AskContext, SchemaClient } from './db';
import { executeProposal, PROPOSAL_TOOL_NAMES, PROPOSAL_TOOLS, type ProposeContext } from './propose';

/**
 * The four proposals Dash may make (plans #1188, #1296), against an in-memory client
 * holding two people's rows side by side. Each is checked the way its page's
 * action checks it, may only name a row a lookup returned, and keeps a
 * proposed row and nothing else.
 */

const ME = '00000000-0000-4000-8000-00000000000a';
const THEM = '00000000-0000-4000-8000-00000000000b';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

type Row = Record<string, unknown>;

const TABLES: Record<string, Row[]> = {
  items: [
    { id: id(1), user_id: ME, title: 'Find a new job', level: 'goal', status: 'open', archived_at: null },
    { id: id(2), user_id: THEM, title: 'Their goal', level: 'goal', status: 'open', archived_at: null },
    { id: id(3), user_id: ME, title: 'A step', level: 'step', status: 'open', archived_at: null },
    { id: id(4), user_id: ME, title: 'Old goal', level: 'goal', status: 'done', archived_at: null },
    { id: id(5), user_id: ME, title: 'Archived goal', level: 'goal', status: 'open', archived_at: '2026-01-01' },
  ],
  inventory_items: [
    { id: id(11), user_id: ME, name: 'Rain jacket', status: 'owned', order_item_id: id(99) },
    { id: id(12), user_id: THEM, name: 'Their jacket', status: 'owned', order_item_id: id(98) },
    { id: id(13), user_id: ME, name: 'Sold lamp', status: 'sold', order_item_id: id(97) },
    { id: id(14), user_id: ME, name: 'Gift', status: 'owned', order_item_id: null },
  ],
  watches: [
    { id: id(21), user_id: ME, title: 'Old show', url: 'https://example.com/running', status: 'running' },
    { id: id(22), user_id: THEM, title: 'Their show', url: 'https://example.com/theirs', status: 'running' },
  ],
  push_subscriptions: [],
  events: [
    { id: id(41), user_id: ME, title: 'Madeon at the Fillmore' },
    { id: id(42), user_id: THEM, title: 'Their gig' },
  ],
};

function context(
  opts: { enabled?: AskContext['enabledModules']; seen?: [string, string][]; push?: boolean } = {},
) {
  TABLES.push_subscriptions = opts.push ? [{ id: id(31), user_id: ME }] : [];
  const writes: string[] = [];
  const kept: NewDashChange[] = [];
  const client = {
    from: (table: string) => {
      const filters: ((row: Row) => boolean)[] = [];
      const write = (op: string) => () => (writes.push(`${op} ${table}`), query);
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), query),
        is: (column: string, value: null) => (filters.push((row) => (row[column] ?? null) === value), query),
        limit: () => query,
        insert: write('insert'),
        update: write('update'),
        delete: write('delete'),
        then: (resolve: (value: unknown) => void) =>
          resolve({ data: (TABLES[table] ?? []).filter((row) => filters.every((f) => f(row))), error: null }),
      };
      return query;
    },
  } as unknown as SchemaClient;
  const seen = new Set((opts.seen ?? []).map(([t, r]) => `${t} ${r}`));
  const ctx: ProposeContext = {
    userId: ME,
    today: '2026-09-27',
    enabledModules: opts.enabled ?? ['todo', 'goals', 'shopping'],
    db: async () => client,
    searchSources: [],
    now: Date.parse('2026-10-01T14:00:00Z'),
    timezone: 'America/New_York',
    seen: (table, ref) => seen.has(`${table} ${ref}`),
    save: async (change) => {
      kept.push(change);
      return { ...change, id: 'c1', status: 'proposed' } as DashChange;
    },
  };
  return { ctx, writes, kept };
}

const GOAL = (n: number): [string, string] => ['goals.items', id(n)];
const ITEM = (n: number): [string, string] => ['public.inventory_items', id(n)];

describe('executeProposal', () => {
  it('offers exactly the five tools', () => {
    expect(PROPOSAL_TOOLS.map((t) => t.name)).toEqual([...PROPOSAL_TOOL_NAMES]);
    expect(PROPOSAL_TOOL_NAMES).toEqual([
      'propose_todo',
      'propose_goal_step',
      'propose_returned',
      'propose_watch',
      'propose_attach_email',
    ]);
  });

  it('refuses a kind outside the four', async () => {
    const { ctx, kept } = context();
    const result = await executeProposal('propose_delete_todo', {}, ctx);
    expect(result).toEqual({
      ok: false,
      error: 'There is no tool called propose_delete_todo. You can propose only a todo, a goal step, a return or a watch.',
    });
    expect(kept).toEqual([]);
  });

  it('keeps a todo in the shape createTask takes, and writes nothing else', async () => {
    const { ctx, kept, writes } = context();
    const result = await executeProposal('propose_todo', { title: ' Call the dentist ', due_on: '2026-10-02' }, ctx);
    expect(result.ok).toBe(true);
    expect(kept).toEqual([
      { kind: 'add_todo', input: { title: 'Call the dentist', body: null, dueOn: '2026-10-02', dueTime: null, pinned: false } },
    ]);
    expect(writes).toEqual([]);
    if (result.ok) expect(result.note).toContain('Proposed: Add the todo "Call the dentist", due 2026-10-02.');
  });

  it('refuses a todo the add bar would refuse', async () => {
    const { ctx, kept } = context();
    expect(await executeProposal('propose_todo', { title: '  ' }, ctx)).toEqual({ ok: false, error: 'Give it a title.' });
    expect(await executeProposal('propose_todo', { title: 'x', due_on: 'Friday' }, ctx)).toEqual({
      ok: false,
      error: 'Use a date like 2026-03-10',
    });
    expect(kept).toEqual([]);
  });

  it('keeps a step under a goal a lookup returned', async () => {
    const { ctx, kept } = context({ seen: [GOAL(1)] });
    const result = await executeProposal('propose_goal_step', { goal_ref: id(1), title: 'Update my CV' }, ctx);
    expect(result.ok).toBe(true);
    expect(kept).toEqual([
      { kind: 'add_goal_step', input: { parentId: id(1), goalTitle: 'Find a new job', title: 'Update my CV', kind: 'mine' } },
    ]);
  });

  it('refuses a goal no lookup returned, even one of theirs', async () => {
    const { ctx, kept } = context({ seen: [ITEM(11)] });
    const result = await executeProposal('propose_goal_step', { goal_ref: id(1), title: 'Update my CV' }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/^No lookup in this conversation returned goals.items/);
    expect(kept).toEqual([]);
  });

  it('refuses a goal that is not theirs, a step, a closed goal and an archived one', async () => {
    const { ctx, kept } = context({ seen: [GOAL(2), GOAL(3), GOAL(4), GOAL(5)] });
    const errors = [];
    for (const n of [2, 3, 4, 5]) {
      const result = await executeProposal('propose_goal_step', { goal_ref: id(n), title: 'A step' }, ctx);
      errors.push(result.ok ? null : result.error);
    }
    expect(errors).toEqual([
      'That goal is not one of theirs, or it has been archived.',
      'That row is a step, not a goal. Name the goal it sits under.',
      'That goal is done, so a step cannot go under it.',
      'That goal is not one of theirs, or it has been archived.',
    ]);
    expect(kept).toEqual([]);
  });

  it('keeps a return for an owned item linked to an order', async () => {
    const { ctx, kept, writes } = context({ seen: [ITEM(11)] });
    const result = await executeProposal('propose_returned', { item_ref: id(11) }, ctx);
    expect(result.ok).toBe(true);
    expect(kept).toEqual([{ kind: 'mark_returned', input: { id: id(11), itemTitle: 'Rain jacket' } }]);
    expect(writes).toEqual([]);
  });

  it('refuses an item no lookup returned, one that is not theirs, not owned, or not from an order', async () => {
    const { ctx, kept } = context({ seen: [ITEM(12), ITEM(13), ITEM(14)] });
    const errors = [];
    for (const n of [11, 12, 13, 14]) {
      const result = await executeProposal('propose_returned', { item_ref: id(n) }, ctx);
      errors.push(result.ok ? null : result.error);
    }
    expect(errors[0]).toMatch(/^No lookup in this conversation returned public.inventory_items/);
    expect(errors.slice(1)).toEqual([
      'That item could not be found.',
      'Only owned items can be marked returned.',
      'This item is not linked to an order, so it cannot be returned.',
    ]);
    expect(kept).toEqual([]);
  });

  it('refuses a proposal into a workspace that is switched off', async () => {
    const { ctx, kept } = context({ enabled: ['goals'], seen: [ITEM(11)] });
    expect(await executeProposal('propose_returned', { item_ref: id(11) }, ctx)).toEqual({
      ok: false,
      error: 'The Shopping workspace is switched off, so nothing can be proposed there.',
    });
    expect(kept).toEqual([]);
  });

  describe('propose_attach_email', () => {
    const MAIL = `${id(50)}:18f2a`;
    const ASK = { mail_ref: MAIL, subject: 'Your Madeon tickets', target_table: 'todo.events', target_ref: id(41) };
    const seen: [string, string][] = [['gmail', MAIL], ['todo.events', id(41)], ['todo.events', id(42)]];

    it('keeps a proposal naming the message and the event, writing nothing', async () => {
      const { ctx, kept, writes } = context({ seen });
      const result = await executeProposal('propose_attach_email', ASK, ctx);
      expect(result.ok).toBe(true);
      expect(writes).toEqual([]);
      expect(kept).toEqual([
        {
          kind: 'attach_email',
          input: {
            accountId: id(50),
            messageId: '18f2a',
            subject: 'Your Madeon tickets',
            from: null,
            targetKind: 'event',
            targetId: id(41),
            targetTitle: 'Madeon at the Fillmore',
          },
        },
      ]);
    });

    it('refuses a message no search returned, an event no lookup returned, and one that is not theirs', async () => {
      const noMail = context({ seen: [['todo.events', id(41)]] });
      expect((await executeProposal('propose_attach_email', ASK, noMail.ctx)).ok).toBe(false);
      const noEvent = context({ seen: [['gmail', MAIL]] });
      expect((await executeProposal('propose_attach_email', ASK, noEvent.ctx)).ok).toBe(false);
      const theirs = context({ seen });
      expect((await executeProposal('propose_attach_email', { ...ASK, target_ref: id(42) }, theirs.ctx)).ok).toBe(false);
      expect(noMail.kept.length + noEvent.kept.length + theirs.kept.length).toBe(0);
    });
  });

  describe('propose_watch', () => {
    const ASK = {
      title: 'Jamie xx at Nowadays',
      url: 'https://www.crowdvolt.com/event/jamie-xx',
      below: 200,
      currency: 'usd',
      report_times: ['18:00', '9:00'],
      ends_on: '2026-10-18',
    };

    it('keeps the watch a confirm will insert, in the person\'s zone, and writes nothing else', async () => {
      const { ctx, kept, writes } = context({ push: true });
      const result = await executeProposal('propose_watch', ASK, ctx);
      expect(result.ok).toBe(true);
      expect(kept).toEqual([
        {
          kind: 'start_watch',
          input: {
            title: 'Jamie xx at Nowadays',
            url: 'https://www.crowdvolt.com/event/jamie-xx',
            below: 200,
            currency: 'USD',
            reportTimes: ['09:00', '18:00'],
            // 23:59 on the 18th in New York, during daylight time.
            endsAt: '2026-10-19T03:59:00.000Z',
            endsOn: '2026-10-18',
            goalItemId: null,
            goalTitle: null,
            pushOn: true,
          },
        },
      ]);
      expect(writes).toEqual([]);
      expect(result.ok && result.note).not.toContain('No device has push');
    });

    it('tells Dash to say nothing will reach the phone when no device has push on', async () => {
      const { ctx, kept } = context({ push: false });
      const result = await executeProposal('propose_watch', ASK, ctx);
      expect(kept[0]).toMatchObject({ input: { pushOn: false } });
      expect(result.ok && result.note).toContain(
        'No device has push switched on, so the watch will show on the home page but nothing will reach your phone.',
      );
      expect(result.ok && result.note).toContain('Switch push on in Account');
    });

    it('ties it to a goal step a lookup returned', async () => {
      const { ctx, kept } = context({ seen: [GOAL(3)] });
      const result = await executeProposal('propose_watch', { ...ASK, goal_item_ref: id(3) }, ctx);
      expect(result.ok).toBe(true);
      expect(kept[0]).toMatchObject({ input: { goalItemId: id(3), goalTitle: 'A step' } });
    });

    it('refuses a goal ref no lookup returned, or one that is not theirs or is closed', async () => {
      for (const [n, seen] of [
        [3, false],
        [2, true],
        [4, true],
      ] as const) {
        const { ctx, kept } = context({ seen: seen ? [GOAL(n)] : [] });
        const result = await executeProposal('propose_watch', { ...ASK, goal_item_ref: id(n) }, ctx);
        expect(result.ok).toBe(false);
        expect(kept).toEqual([]);
      }
    });

    it('refuses what the table or the run would not take', async () => {
      const cases: [Record<string, unknown>, string][] = [
        [{ url: 'http://example.com/x' }, 'Only an https page can be watched.'],
        [{ url: 'tickets' }, 'url is not a web address'],
        [{ below: undefined, report_times: [] }, 'A watch needs a price to go under, report times, or both'],
        [{ below: -5 }, 'below has to be a price above zero.'],
        [{ report_times: ['25:00'] }, '25:00 is not a time of day'],
        [{ ends_on: '2026-09-30' }, 'That end is already past.'],
        [{ ends_on: '2027-09-30' }, 'A watch can run for at most 180 days.'],
        [{ title: '  ' }, 'Give the watch a title'],
        [{ url: 'https://example.com/running' }, 'A watch on that page is already running ("Old show")'],
      ];
      for (const [change, error] of cases) {
        const { ctx, kept } = context();
        const result = await executeProposal('propose_watch', { ...ASK, ...change }, ctx);
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toContain(error);
        expect(kept).toEqual([]);
      }
    });

    it('needs no workspace, but a goal link needs Goals on', async () => {
      const off = context({ enabled: [], seen: [GOAL(3)] });
      expect((await executeProposal('propose_watch', ASK, off.ctx)).ok).toBe(true);
      const linked = await executeProposal('propose_watch', { ...ASK, goal_item_ref: id(3) }, off.ctx);
      expect(!linked.ok && linked.error).toContain('The Goals workspace is switched off');
    });
  });
});

import { describe, expect, it } from 'vitest';
import type { DashChange, NewDashChange } from '@/lib/talk/changes';
import type { AskContext, SchemaClient } from './db';
import { executeProposal, PROPOSAL_TOOL_NAMES, PROPOSAL_TOOLS, type ProposeContext } from './propose';

/**
 * The three proposals Dash may make (plan #1188), against an in-memory client
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
};

function context(opts: { enabled?: AskContext['enabledModules']; seen?: [string, string][] } = {}) {
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
  it('offers exactly the three tools', () => {
    expect(PROPOSAL_TOOLS.map((t) => t.name)).toEqual([...PROPOSAL_TOOL_NAMES]);
    expect(PROPOSAL_TOOL_NAMES).toEqual(['propose_todo', 'propose_goal_step', 'propose_returned']);
  });

  it('refuses a kind outside the three', async () => {
    const { ctx, kept } = context();
    const result = await executeProposal('propose_delete_todo', {}, ctx);
    expect(result).toEqual({
      ok: false,
      error: 'There is no tool called propose_delete_todo. You can propose only a todo, a goal step or a return.',
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
});

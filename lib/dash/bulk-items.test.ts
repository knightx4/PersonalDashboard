import { beforeEach, describe, expect, it } from 'vitest';
import { undoChange, type ChangeDeps } from '@/lib/ask/changes';
import { changeHref, changeSentence, changeWhere } from '@/lib/ask/change-view';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { insertMadeChange, type DashChange, type MadeDashChange } from '@/lib/talk/changes';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import { BULK_MAX } from './bulk-items';
import type { DashWriteContext, DashWriteResult } from './registry';
import type { RowSet } from './sets';
import { WRITE_TOOLS } from './writes';

/**
 * Dash changing many shopping items at once (plan #1656): a rule such as
 * "everything from the March Amazon order" changes those items in one
 * write, the reply's summary says how many, and one Undo puts them all
 * back. One in-memory database stands in for the person's clients.
 */

const ME = '00000000-0000-4000-8000-0000000000cc';
const SOMEONE = '00000000-0000-4000-8000-0000000000dd';
const ORDER = '00000000-0000-4000-8000-00000000e001';
const LINE_A = '00000000-0000-4000-8000-00000000e101';
const LINE_B = '00000000-0000-4000-8000-00000000e102';
const KINDLE = '00000000-0000-4000-8000-00000000f001';
const LAMP = '00000000-0000-4000-8000-00000000f002';
const MUG = '00000000-0000-4000-8000-00000000f003';
const SOLD = '00000000-0000-4000-8000-00000000f004';
const THEIRS = '00000000-0000-4000-8000-00000000f005';

let tables: FakeTables;
let seen: Set<string>;
/** The sets lookups in this answer named; their rows count as seen, as runDash has it. */
let sets: Map<string, RowSet>;

function addSet(table: string, refs: string[], size = refs.length): string {
  const name = `set ${sets.size + 1}`;
  sets.set(name, { name, table, refs, size });
  for (const ref of refs) seen.add(`${table}:${ref}`);
  return name;
}

function item(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    user_id: ME,
    name,
    short_name: null,
    status: 'owned',
    for_sale: false,
    return_planned: false,
    group_id: null,
    order_item_id: null,
    fingerprint_loose: null,
    acquired_at: '2026-03-04',
    ...extra,
  };
}

function context(enabled: DashWriteContext['enabledModules'] = ['shopping']): DashWriteContext {
  const client = fakeSchemaDb(tables);
  return {
    userId: ME,
    today: '2026-10-08',
    timezone: 'UTC',
    enabledModules: enabled,
    db: async (schema) => client(schema),
    searchSources: [],
    seen: Object.assign((table: string, ref: string) => seen.has(`${table}:${ref}`), { sets }),
    goals: async () => client('goals') as unknown as GoalsSupabaseClient,
    createTask: async () => ({ id: null, error: 'unused' }),
  };
}

function apply(input: unknown, ctx = context()): Promise<DashWriteResult> {
  const tool = WRITE_TOOLS.find((t) => t.name === 'change_items');
  if (!tool) throw new Error('no change_items tool');
  return tool.apply(ctx, input);
}

function ok(result: DashWriteResult): Extract<DashWriteResult, { ok: true }> {
  if (!result.ok) throw new Error(result.error);
  return result;
}

function deps(): ChangeDeps {
  const client = fakeSchemaDb(tables);
  return {
    userId: ME,
    timezone: 'UTC',
    today: '2026-10-08',
    enabledModules: ['shopping'],
    core: client('core'),
    db: async (schema) => client(schema),
    goals: async () => client('goals') as unknown as GoalsSupabaseClient,
    createTask: async () => ({ id: null, error: 'unused' }),
    now: () => '2026-10-08T12:00:00Z',
  };
}

/** Keeps the write as Ask does: one record. */
async function keep(result: Extract<DashWriteResult, { ok: true }>): Promise<DashChange> {
  const core = fakeSchemaDb(tables)('core') as unknown as CoreSupabaseClient;
  return insertMadeChange(core, ME, 'conv-1', { ...result, undo: result.undo ?? null } as unknown as MadeDashChange);
}

const itemRow = (id: string) => tables['public.inventory_items'].find((row) => row.id === id)!;

beforeEach(() => {
  seen = new Set();
  sets = new Map();
  tables = {
    'core.dash_actions': [],
    'public.orders': [{ id: ORDER, user_id: ME, deleted_at: null }],
    'public.order_items': [
      { id: LINE_A, order_id: ORDER },
      { id: LINE_B, order_id: ORDER },
    ],
    'public.inventory_items': [
      item(KINDLE, 'Kindle Paperwhite', { order_item_id: LINE_A }),
      item(LAMP, 'Desk lamp', { order_item_id: LINE_A }),
      item(MUG, 'Mug', { order_item_id: LINE_B, short_name: 'Blue mug' }),
      item(SOLD, 'Old router', { order_item_id: LINE_B, status: 'sold' }),
      item(THEIRS, 'Not mine', { user_id: SOMEONE }),
    ],
    'public.item_groups': [],
  };
});

describe('change_items', () => {
  it('marks everything from an order for sale, says how many, and one Undo puts them all back', async () => {
    seen.add(`public.orders:${ORDER}`);
    const result = ok(await apply({ change: 'for_sale', order_refs: [ORDER] }));

    expect([KINDLE, LAMP, MUG].map((id) => itemRow(id).for_sale)).toEqual([true, true, true]);
    // A sold item is not put on the sell page.
    expect(itemRow(SOLD).for_sale).toBe(false);
    expect(result).toMatchObject({
      kind: 'change_items',
      op: 'update',
      subjectRef: `public.inventory_items:${KINDLE}`,
      input: { change: 'for_sale', count: 3, titles: ['Kindle Paperwhite', 'Desk lamp', 'Blue mug'], left: 1 },
      row: { table: 'public.inventory_items', ref: KINDLE, href: '/shopping/sell' },
    });
    expect(result.summary).toBe(
      'Dash marked 3 items for sale: Kindle Paperwhite, Desk lamp and Blue mug. 1 was left as it was, already set that way or no longer owned.',
    );

    const kept = await keep(result);
    expect(tables['core.dash_actions']).toHaveLength(1);
    expect(changeSentence(kept, true)).toBe('Marked 3 items for sale: Kindle Paperwhite, Desk lamp and Blue mug');
    expect(changeHref(kept)).toBe('/shopping/sell');
    expect(changeWhere(kept)).toBe('Open the sell page');

    const undone = await undoChange(deps(), kept.id);
    expect(undone).toMatchObject({ ok: true, change: { status: 'undone' } });
    expect([KINDLE, LAMP, MUG].map((id) => itemRow(id).for_sale)).toEqual([false, false, false]);
  });

  it("changes exactly the items a lookup's set matched, as one record with one Undo (plan #2472.2)", async () => {
    const name = addSet('public.inventory_items', [KINDLE, MUG]);
    const result = ok(await apply({ change: 'for_sale', set: name }));

    expect([KINDLE, LAMP, MUG].map((id) => itemRow(id).for_sale)).toEqual([true, false, true]);
    expect(result.summary).toBe('Dash marked 2 items for sale: Kindle Paperwhite and Blue mug.');
    const kept = await keep(result);
    expect(tables['core.dash_actions']).toHaveLength(1);
    expect((await undoChange(deps(), kept.id)).ok).toBe(true);
    expect([KINDLE, MUG].map((id) => itemRow(id).for_sale)).toEqual([false, false]);
  });

  it("takes a set of orders as every item from them, and the model's other spellings of its name", async () => {
    addSet('public.orders', [ORDER]);
    const result = ok(await apply({ change: 'to_return', set: 'Set 1' }));
    expect([KINDLE, LAMP, MUG].map((id) => itemRow(id).return_planned)).toEqual([true, true, true]);
    expect(result.input).toMatchObject({ count: 3 });
  });

  it('merges a set with item_refs, counting a row named twice once', async () => {
    const name = addSet('public.inventory_items', [KINDLE, LAMP]);
    seen.add(`public.inventory_items:${MUG}`);
    const result = ok(await apply({ change: 'for_sale', set: name, item_refs: [LAMP, MUG] }));
    expect(result.input).toMatchObject({ count: 3, left: 0 });
    expect([KINDLE, LAMP, MUG].map((id) => itemRow(id).for_sale)).toEqual([true, true, true]);
  });

  it('refuses a set of another table, one no lookup made, and one over the cap, changing nothing', async () => {
    const roles = addSet('job_search.roles', ['00000000-0000-4000-8000-0000000000a1']);
    const wrong = await apply({ change: 'for_sale', set: roles, item_refs: [] });
    expect(!wrong.ok && wrong.error).toContain('holds rows of job_search.roles');

    const missing = await apply({ change: 'for_sale', set: 'set 9' });
    expect(!missing.ok && missing.error).toContain('There is no set 9');

    const big = addSet('public.inventory_items', [], BULK_MAX + 1);
    const over = await apply({ change: 'for_sale', set: big });
    expect(!over.ok && over.error).toContain(`more than the ${BULK_MAX}`);

    expect(tables['public.inventory_items'].some((row) => row.for_sale)).toBe(false);
    expect(tables['core.dash_actions']).toHaveLength(0);
  });

  it('leaves alone on Undo an item changed by hand since, and puts the rest back', async () => {
    for (const id of [KINDLE, LAMP]) seen.add(`public.inventory_items:${id}`);
    const kept = await keep(ok(await apply({ change: 'to_return', item_refs: [KINDLE, LAMP] })));
    itemRow(LAMP).return_planned = false;
    itemRow(LAMP).for_sale = true;

    const undone = await undoChange(deps(), kept.id);
    expect(undone.ok).toBe(true);
    expect(itemRow(KINDLE).return_planned).toBe(false);
    expect(itemRow(LAMP)).toMatchObject({ return_planned: false, for_sale: true });

    // Nothing left to put back: a second record over the same rows is refused.
    itemRow(KINDLE).return_planned = true;
    const again = await keep(ok(await apply({ change: 'not_returning', item_refs: [KINDLE] })));
    itemRow(KINDLE).return_planned = true;
    const refused = await undoChange(deps(), again.id);
    expect(refused).toMatchObject({ ok: false });
    expect(!refused.ok && refused.error).toContain('changed since');
  });

  it('groups copies as one item, and Undo ungroups them and removes the group it made', async () => {
    for (const id of [KINDLE, LAMP]) seen.add(`public.inventory_items:${id}`);
    const result = ok(await apply({ change: 'group', item_refs: [KINDLE, LAMP] }));
    expect(tables['public.item_groups']).toHaveLength(1);
    const group = tables['public.item_groups'][0].id;
    expect([itemRow(KINDLE).group_id, itemRow(LAMP).group_id]).toEqual([group, group]);
    expect(result.summary).toBe('Dash grouped 2 copies as one item: Kindle Paperwhite and Desk lamp.');

    const kept = await keep(result);
    expect(changeSentence(kept, true)).toBe('Grouped 2 copies as one item: Kindle Paperwhite and Desk lamp');
    expect((await undoChange(deps(), kept.id)).ok).toBe(true);
    expect([itemRow(KINDLE).group_id, itemRow(LAMP).group_id]).toEqual([null, null]);
    expect(tables['public.item_groups']).toHaveLength(0);
  });

  it('marks items as given away, and Undo puts them back as owned (plan #1894.5.1)', async () => {
    for (const id of [KINDLE, LAMP, SOLD]) seen.add(`public.inventory_items:${id}`);
    const result = ok(await apply({ change: 'dispose', disposal_method: 'gifted', item_refs: [KINDLE, LAMP, SOLD] }));
    expect(itemRow(KINDLE)).toMatchObject({ status: 'gifted', disposal_method: 'gifted', disposed_at: '2026-10-08' });
    expect(itemRow(SOLD).status).toBe('sold');
    expect(result.summary).toBe(
      'Dash marked 2 items as given away: Kindle Paperwhite and Desk lamp. 1 was left as it was, already set that way or no longer owned.',
    );
    const kept = await keep(result);
    expect(changeSentence(kept, true)).toBe('Marked 2 items as given away: Kindle Paperwhite and Desk lamp');

    expect((await undoChange(deps(), kept.id)).ok).toBe(true);
    expect(itemRow(KINDLE)).toMatchObject({ status: 'owned', disposal_method: null, disposed_at: null });
    expect(itemRow(LAMP).status).toBe('owned');
  });

  it('takes proceeds for one item sold, and refuses them over many', async () => {
    for (const id of [KINDLE, LAMP]) seen.add(`public.inventory_items:${id}`);
    const many = await apply({ change: 'dispose', disposal_method: 'sold', proceeds: 40, item_refs: [KINDLE, LAMP] });
    expect(!many.ok && many.error).toContain('one item at a time');
    ok(await apply({ change: 'dispose', disposal_method: 'sold', proceeds: 40, item_refs: [KINDLE] }));
    expect(itemRow(KINDLE)).toMatchObject({ status: 'sold', disposal_proceeds_cents: 4000 });
    const bad = await apply({ change: 'dispose', disposal_method: 'burned', item_refs: [LAMP] });
    expect(!bad.ok && bad.error).toContain('disposal_method must be one of');
  });

  it('ungroups every copy in the group, clears the key it claimed, and Undo puts both back', async () => {
    const GROUP = '00000000-0000-4000-8000-00000000a001';
    tables['public.item_groups'].push({ id: GROUP, user_id: ME, name: 'Kindle', group_key: 'kindle' });
    itemRow(KINDLE).group_id = GROUP;
    itemRow(LAMP).group_id = GROUP;
    seen.add(`public.inventory_items:${KINDLE}`);

    const result = ok(await apply({ change: 'ungroup', item_refs: [KINDLE] }));
    expect([itemRow(KINDLE).group_id, itemRow(LAMP).group_id]).toEqual([null, null]);
    // Kept, keyless, so nothing draws the copies back in and Undo has it to put them into.
    expect(tables['public.item_groups']).toMatchObject([{ id: GROUP, group_key: null }]);
    expect(result.summary).toBe(
      'Dash ungrouped 2 copies, so they stack by their own details again: Kindle Paperwhite and Desk lamp.',
    );

    expect((await undoChange(deps(), (await keep(result)).id)).ok).toBe(true);
    expect([itemRow(KINDLE).group_id, itemRow(LAMP).group_id]).toEqual([GROUP, GROUP]);
    expect(tables['public.item_groups'][0].group_key).toBe('kindle');
  });

  it('separates a copy into a group of its own, and Undo removes the group it made', async () => {
    seen.add(`public.inventory_items:${MUG}`);
    const result = ok(await apply({ change: 'separate', item_refs: [MUG] }));
    expect(tables['public.item_groups']).toMatchObject([{ name: 'Blue mug', group_key: null }]);
    expect(itemRow(MUG).group_id).toBe(tables['public.item_groups'][0].id);
    expect(result.summary).toBe('Dash separated 1 copy from its stack: Blue mug.');

    expect((await undoChange(deps(), (await keep(result)).id)).ok).toBe(true);
    expect(itemRow(MUG).group_id).toBeNull();
    expect(tables['public.item_groups']).toHaveLength(0);
  });

  it('refuses rows that are not the person\'s, and changes nothing', async () => {
    for (const id of [KINDLE, THEIRS]) seen.add(`public.inventory_items:${id}`);
    const result = await apply({ change: 'for_sale', item_refs: [KINDLE, THEIRS] });
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.error).toContain('not items of theirs');
    expect(itemRow(KINDLE).for_sale).toBe(false);
    expect(tables['core.dash_actions']).toHaveLength(0);
  });

  it('refuses items no lookup returned', async () => {
    const result = await apply({ change: 'for_sale', item_refs: [KINDLE] });
    expect(!result.ok && result.error).toContain('No lookup in this conversation returned public.inventory_items');
    expect(itemRow(KINDLE).for_sale).toBe(false);
  });

  it(`refuses more than ${BULK_MAX} items at once`, async () => {
    const many = Array.from({ length: BULK_MAX + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    for (const id of many) {
      seen.add(`public.inventory_items:${id}`);
      tables['public.inventory_items'].push(item(id, `Thing ${i(id)}`));
    }
    const result = await apply({ change: 'for_sale', item_refs: many });
    expect(!result.ok && result.error).toContain(`At most ${BULK_MAX} items`);
    expect(tables['public.inventory_items'].every((row) => row.for_sale === false)).toBe(true);

    // Exactly the limit goes through.
    const done = ok(await apply({ change: 'for_sale', item_refs: many.slice(0, BULK_MAX) }));
    expect(done.input).toMatchObject({ count: BULK_MAX });
    expect(done.summary).toContain(`and ${BULK_MAX - 3} more`);
  });

  it('has no delete, and says where deleting is done', async () => {
    seen.add(`public.inventory_items:${KINDLE}`);
    const result = await apply({ change: 'delete', item_refs: [KINDLE] });
    expect(!result.ok && result.error).toContain('Deleting items is done on the inventory list');
    expect(tables['public.inventory_items']).toHaveLength(5);
  });

  it('says so when every item is already set that way', async () => {
    seen.add(`public.inventory_items:${KINDLE}`);
    const result = await apply({ change: 'not_for_sale', item_refs: [KINDLE] });
    expect(!result.ok && result.error).toContain('already set that way');
  });

  it('refuses while Shopping is switched off', async () => {
    seen.add(`public.orders:${ORDER}`);
    const result = await apply({ change: 'for_sale', order_refs: [ORDER] }, context(['todo']));
    expect(!result.ok && result.error).toContain('Shopping workspace is switched off');
  });
});

function i(id: string): number {
  return Number(id.slice(-12));
}

import { beforeEach, describe, expect, it } from 'vitest';
import { undoChange, type ChangeDeps } from '@/lib/ask/changes';
import { changeHref, changeSentence, changeWhere } from '@/lib/ask/change-view';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { insertMadeChange, type DashChange, type MadeDashChange } from '@/lib/talk/changes';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import { BULK_MAX } from './bulk-items';
import type { DashWriteContext, DashWriteResult } from './registry';
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
    seen: (table, ref) => seen.has(`${table}:${ref}`),
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

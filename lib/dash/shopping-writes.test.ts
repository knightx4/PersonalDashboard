import { beforeEach, describe, expect, it, vi } from 'vitest';
import { undoChange, type ChangeDeps } from '@/lib/ask/changes';
import { changeSentence } from '@/lib/ask/change-view';
import { SHOPPING_CHANGE_KINDS } from '@/lib/ask/shopping-changes';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { recordDashAction, undoneByAsk } from '@/lib/core/dash-actions';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { insertMadeChange, type DashChange, type MadeDashChange } from '@/lib/talk/changes';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import { SHOPPING_WRITES, SHOPPING_WRITE_TOOLS, runShoppingWrite, type ShoppingMade } from './shopping-writes';
import type { DashWriteContext, DashWriteResult } from './registry';

/**
 * The Shopping writes for one item or one list (plan #1894.5.1): each checks
 * every ref against the person (the connector runs them with no row level
 * security), keeps every row it touched, and one Undo puts them all back,
 * whether Ask or the connector made the change.
 */

// Stacking is derived from details the fake rows do not carry; two copies named alike stand for a stack.
vi.mock('@/lib/inventory/stack-siblings', () => ({
  stackSiblingIds: async (client: { from: (t: string) => unknown }, userId: string, id: string) => {
    const { data } = (await (client.from('inventory_items') as { select: () => { eq: (c: string, v: string) => Promise<{ data: Record<string, unknown>[] }> } })
      .select()
      .eq('user_id', userId)) as { data: Record<string, unknown>[] };
    const me = data.find((row) => row.id === id);
    return data.filter((row) => row.status === 'owned' && row.name === me?.name).map((row) => row.id as string);
  },
}));

// The book catalogs: one ISBN they carry, every other one unknown.
vi.mock('@/lib/books/resolve', () => ({
  resolveBook: async ({ isbn }: { isbn: string }) =>
    isbn === '9780441172719'
      ? {
          isbn13: '9780441172719',
          isbn10: '0441172717',
          title: 'Dune',
          authors: ['Frank Herbert'],
          publisher: 'Ace',
          publishedYear: 1990,
          edition: null,
          coverUrl: 'https://covers.example/dune.jpg',
          weightGrams: null,
          matchConfidence: 1,
          needsConfirmation: false,
          resolutionSource: 'google_books',
          alternates: [],
          confirmationReason: null,
        }
      : null,
}));

const ME = '00000000-0000-4000-8000-0000000000cc';
const SOMEONE = '00000000-0000-4000-8000-0000000000dd';
const CATAN = '00000000-0000-4000-8000-00000000f001';
const CATAN_TWO = '00000000-0000-4000-8000-00000000f002';
const DUNE = '00000000-0000-4000-8000-00000000f003';
const THEIRS = '00000000-0000-4000-8000-00000000f004';
const DUNE_DETAILS = '00000000-0000-4000-8000-00000000d001';
const GROUP = '00000000-0000-4000-8000-00000000a001';
const GIFTS = '00000000-0000-4000-8000-00000000b001';

let tables: FakeTables;

function item(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    user_id: ME,
    name,
    short_name: null,
    variant: null,
    notes: null,
    category_id: null,
    status: 'owned',
    group_id: null,
    search_tags: [],
    manual_expected_price_cents: null,
    ...extra,
  };
}

beforeEach(() => {
  tables = {
    'core.dash_actions': [],
    'public.inventory_items': [
      item(CATAN, 'Catan', { group_id: GROUP }),
      item(CATAN_TWO, 'Catan', { group_id: GROUP }),
      item(DUNE, 'Dune', { notes: 'Signed copy' }),
      item(THEIRS, 'Not mine', { user_id: SOMEONE }),
    ],
    'public.item_groups': [{ id: GROUP, user_id: ME, name: 'Catan', group_key: 'catan' }],
    'public.book_details': [
      {
        id: DUNE_DETAILS,
        inventory_item_id: DUNE,
        isbn_13: null,
        condition: null,
        needs_confirmation: true,
        candidates: [{ title: 'Dune (1965)' }],
        confirmation_reason: 'Two editions match.',
        manual_expected_price_cents: null,
      },
    ],
    'public.game_details': [],
    'public.categories': [
      { id: 'cat-books', user_id: null, slug: 'books', name: 'Books' },
      { id: 'cat-games', user_id: null, slug: 'board-games', name: 'Board games' },
      { id: 'cat-kitchen', user_id: null, slug: 'kitchen', name: 'Kitchen' },
      { id: 'cat-theirs', user_id: SOMEONE, slug: 'tools', name: 'Tools' },
    ],
    'public.profiles': [{ id: ME, timezone: 'UTC' }],
    'public.inventory_item_tags': [],
    'public.item_uses': [],
    'public.inventory_item_families': [],
    'public.returns': [],
    'todo.task_links': [],
    'public.item_lists': [{ id: GIFTS, user_id: ME, name: 'Gifts', slug: 'gifts', color: null }],
    'public.inventory_item_lists': [],
  };
});

const env = () => ({ userId: ME, shop: fakeSchemaDb(tables)('public') });
const write = (name: string) => SHOPPING_WRITES.find((entry) => entry.name === name)!;

async function made(name: string, input: Record<string, unknown>): Promise<ShoppingMade> {
  const result = await runShoppingWrite(write(name), env(), input);
  if ('ok' in result) throw new Error(result.error);
  return result;
}

async function refused(name: string, input: Record<string, unknown>): Promise<string> {
  const result = await runShoppingWrite(write(name), env(), input);
  if (!('ok' in result)) throw new Error('expected a refusal');
  return result.error;
}

function context(): DashWriteContext {
  const client = fakeSchemaDb(tables);
  return {
    userId: ME,
    today: '2026-10-14',
    timezone: 'UTC',
    enabledModules: ['shopping'],
    db: async (schema) => client(schema),
    searchSources: [],
    seen: () => true,
    goals: async () => client('goals') as unknown as GoalsSupabaseClient,
    createTask: async () => ({ id: null, error: 'unused' }),
  };
}

function deps(): ChangeDeps {
  const client = fakeSchemaDb(tables);
  return {
    userId: ME,
    timezone: 'UTC',
    today: '2026-10-14',
    enabledModules: ['shopping'],
    core: client('core'),
    db: async (schema) => client(schema),
    goals: async () => client('goals') as unknown as GoalsSupabaseClient,
    createTask: async () => ({ id: null, error: 'unused' }),
    now: () => '2026-10-14T12:00:00Z',
  };
}

/** Runs the tool as Ask does and keeps it as Ask does: one record. */
async function viaAsk(name: string, input: Record<string, unknown>): Promise<DashChange> {
  const tool = SHOPPING_WRITE_TOOLS.find((t) => t.name === name)!;
  const result = (await tool.apply(context(), input)) as DashWriteResult;
  if (!result.ok) throw new Error(result.error);
  const core = fakeSchemaDb(tables)('core') as unknown as CoreSupabaseClient;
  return insertMadeChange(core, ME, 'conv-1', { ...result, undo: result.undo ?? null } as unknown as MadeDashChange);
}

/** The sentence the newest record keeps, as Home shows it. */
const lastSummary = () => tables['core.dash_actions'].at(-1)?.summary;

const row = (table: string, id: string) => tables[`public.${table}`].find((r) => r.id === id)!;

describe('the Shopping writes', () => {
  it('are the kinds Ask keeps them under, in order', () => {
    expect(SHOPPING_WRITES.map((entry) => entry.name)).toEqual([...SHOPPING_CHANGE_KINDS]);
  });
});

describe('change_item', () => {
  it('renames every copy in the stack, and one Undo puts them all back', async () => {
    const kept = await viaAsk('change_item', { item_ref: CATAN, name: 'Catan (5th edition)' });
    expect([row('inventory_items', CATAN).name, row('inventory_items', CATAN_TWO).name]).toEqual([
      'Catan (5th edition)',
      'Catan (5th edition)',
    ]);
    expect(lastSummary()).toBe('Dash changed "Catan" in Shopping: renamed it "Catan (5th edition)" on all 2 copies.');
    expect(changeSentence(kept, true)).toBe('Changed Catan: renamed it "Catan (5th edition)" on all 2 copies');

    expect(await undoChange(deps(), kept.id)).toMatchObject({ ok: true, change: { status: 'undone' } });
    expect([row('inventory_items', CATAN).name, row('inventory_items', CATAN_TWO).name]).toEqual(['Catan', 'Catan']);
  });

  it("adds a note, sets a book's sell price on its details, renames the group, and Undo puts each back", async () => {
    const result = await made('change_item', { item_ref: DUNE, add_note: 'Planning to list myself.', sell_price: 12.5 });
    expect(row('inventory_items', DUNE).notes).toBe('Signed copy\nPlanning to list myself.');
    expect(row('book_details', DUNE_DETAILS).manual_expected_price_cents).toBe(1250);
    expect(result.summary).toBe(
      'Dash changed "Dune" in Shopping: added the note "Planning to list myself." and set its sell price to $12.50.',
    );

    const group = await viaAsk('change_item', { item_ref: CATAN, group_name: 'Settlers of Catan' });
    expect(row('item_groups', GROUP).name).toBe('Settlers of Catan');
    expect((await undoChange(deps(), group.id)).ok).toBe(true);
    expect(row('item_groups', GROUP).name).toBe('Catan');
  });

  it('keeps a change made by hand since, and refuses when nothing is left to put back', async () => {
    const kept = await viaAsk('change_item', { item_ref: DUNE, notes: 'First edition' });
    row('inventory_items', DUNE).notes = 'Edited by hand';
    const undone = await undoChange(deps(), kept.id);
    expect(undone).toMatchObject({ ok: false });
    expect(row('inventory_items', DUNE).notes).toBe('Edited by hand');
  });

  it("refuses another person's item, a group name for an item in no group, and an empty request", async () => {
    expect(await refused('change_item', { item_ref: THEIRS, name: 'Mine now' })).toContain('no item of theirs');
    expect(row('inventory_items', THEIRS).name).toBe('Not mine');
    expect(await refused('change_item', { item_ref: DUNE, group_name: 'Books' })).toContain('not in a group');
    expect(await refused('change_item', { item_ref: DUNE })).toContain('Say what to change');
    expect(await refused('change_item', { item_ref: DUNE, notes: 'x', add_note: 'y' })).toContain('not both');
  });
});

describe("a book's or game's details", () => {
  it('sets the condition and confirms the edition, and Undo puts the details back', async () => {
    const kept = await viaAsk('change_item', { item_ref: DUNE, condition: 'very_good', confirm_edition: true });
    expect(row('book_details', DUNE_DETAILS)).toMatchObject({ condition: 'very_good', needs_confirmation: false, candidates: [], confirmation_reason: null });
    expect(lastSummary()).toBe('Dash changed "Dune" in Shopping: set its condition to very good and confirmed its edition.');
    expect((await undoChange(deps(), kept.id)).ok).toBe(true);
    expect(row('book_details', DUNE_DETAILS)).toMatchObject({ condition: null, needs_confirmation: true, confirmation_reason: 'Two editions match.' });
  });

  it("refuses a game's condition on a book, and a condition on an item with no details", async () => {
    expect(await refused('change_item', { item_ref: DUNE, condition: 'complete_used' })).toContain('very_good');
    expect(await refused('change_item', { item_ref: CATAN, condition: 'good' })).toContain('not a book or a board game');
  });
});

describe('add_items', () => {
  const added = () => tables['public.inventory_items'].filter((r) => ![CATAN, CATAN_TWO, DUNE, THEIRS].includes(r.id as string));

  it('adds a book by its ISBN, a game and a plain item, as the add pages save them, and Undo takes them away', async () => {
    const kept = await viaAsk('add_items', {
      items: [
        { kind: 'book', isbn: '0-441-17271-7' },
        { kind: 'game', title: 'Wingspan', year: 2019, publisher: 'Stonemaier Games' },
        { kind: 'other', title: 'Le Creuset Dutch oven', variant: 'Flame, 5.5 qt', category: 'Kitchen', cost: 379.95, acquired_on: '2026-09-01' },
      ],
    });
    const [book, game, oven] = added();
    expect(book).toMatchObject({ name: 'Dune', variant: 'Frank Herbert', category_id: 'cat-books', source: 'manual', status: 'owned', acquired_at: '2026-10-14' });
    expect(tables['public.book_details'].find((r) => r.inventory_item_id === book.id)).toMatchObject({ isbn_13: '9780441172719', resolution_source: 'google_books' });
    expect(game).toMatchObject({ name: 'Wingspan', category_id: 'cat-games' });
    expect(tables['public.game_details'].find((r) => r.inventory_item_id === game.id)).toMatchObject({ year_published: 2019, needs_confirmation: false });
    expect(oven).toMatchObject({ category_id: 'cat-kitchen', variant: 'Flame, 5.5 qt', cost_cents: 37995, acquired_at: '2026-09-01' });
    expect(lastSummary()).toBe('Dash added 3 items to Shopping: Dune, Wingspan and Le Creuset Dutch oven.');
    expect(changeSentence(kept, true)).toBe('Added Dune, Wingspan and Le Creuset Dutch oven to your inventory');

    expect(await undoChange(deps(), kept.id)).toMatchObject({ ok: true, change: { status: 'undone' } });
    expect(added()).toHaveLength(0);
  });

  it('saves a book the catalogs lack by hand with its ISBN, and refuses one with neither title nor a known ISBN', async () => {
    const result = await made('add_items', { items: [{ kind: 'book', isbn: '9780306406157', title: 'A New Book', authors: ['A. Writer'] }] });
    expect(result.summary).toBe('Dash added 1 item to Shopping: A New Book.');
    expect(tables['public.book_details'].at(-1)).toMatchObject({ isbn_13: '9780306406157', resolution_source: 'manual', authors: ['A. Writer'] });

    const before = tables['public.inventory_items'].length;
    expect(await refused('add_items', { items: [{ kind: 'game', title: 'Azul' }, { kind: 'book', isbn: '9780306406157' }] })).toContain('No catalog has');
    expect(await refused('add_items', { items: [{ kind: 'book', isbn: '123' }] })).toContain('check digit');
    expect(await refused('add_items', { items: [{ kind: 'other', title: 'Drill', category: 'Tools' }] })).toContain('no category called');
    expect(await refused('add_items', { items: [{ kind: 'game' }] })).toContain('title is missing');
    expect(tables['public.inventory_items']).toHaveLength(before);
  });

  it('keeps an added item something now hangs off, and takes the rest away', async () => {
    const kept = await viaAsk('add_items', { items: [{ kind: 'game', title: 'Azul' }, { kind: 'game', title: 'Patchwork' }] });
    const [azul, patchwork] = added();
    tables['public.inventory_item_lists'].push({ id: 'm-azul', inventory_item_id: azul.id, list_id: GIFTS });
    expect((await undoChange(deps(), kept.id)).ok).toBe(true);
    expect(added().map((r) => r.name)).toEqual(['Azul']);
    expect(added().some((r) => r.id === patchwork.id)).toBe(false);

    const again = await viaAsk('add_items', { items: [{ kind: 'other', title: 'Lamp' }] });
    row('inventory_items', added().find((r) => r.name === 'Lamp')!.id as string).for_sale = true;
    expect(await undoChange(deps(), again.id)).toMatchObject({ ok: false, error: expect.stringContaining('Dash kept it') });
  });
});

describe('item_lists', () => {
  it('makes a list it has none by, puts the items on it, and Undo takes both away', async () => {
    const kept = await viaAsk('item_lists', { change: 'add', list: 'Holiday', item_refs: [DUNE, CATAN] });
    const list = tables['public.item_lists'].find((r) => r.name === 'Holiday')!;
    expect(list).toMatchObject({ user_id: ME, slug: 'holiday' });
    expect(tables['public.inventory_item_lists'].map((r) => r.inventory_item_id)).toEqual([DUNE, CATAN]);
    expect(lastSummary()).toBe('Dash made the list "Holiday" and put 2 items on it: Dune and Catan.');

    expect((await undoChange(deps(), kept.id)).ok).toBe(true);
    expect(tables['public.inventory_item_lists']).toHaveLength(0);
    expect(tables['public.item_lists'].map((r) => r.name)).toEqual(['Gifts']);
  });

  it('keeps a list Dash made once something else is on it', async () => {
    const kept = await viaAsk('item_lists', { change: 'add', list: 'Holiday', item_refs: [DUNE] });
    const list = tables['public.item_lists'].find((r) => r.name === 'Holiday')!;
    tables['public.inventory_item_lists'].push({ id: 'by-hand', inventory_item_id: CATAN, list_id: list.id });
    expect((await undoChange(deps(), kept.id)).ok).toBe(true);
    expect(tables['public.item_lists'].some((r) => r.name === 'Holiday')).toBe(true);
    expect(tables['public.inventory_item_lists'].map((r) => r.inventory_item_id)).toEqual([CATAN]);
  });

  it('takes items off a list and Undo puts them back; renames a list and Undo names it back', async () => {
    tables['public.inventory_item_lists'].push({ id: 'm1', inventory_item_id: DUNE, list_id: GIFTS });
    const off = await viaAsk('item_lists', { change: 'remove', list: 'gifts', item_refs: [DUNE] });
    expect(tables['public.inventory_item_lists']).toHaveLength(0);
    expect(lastSummary()).toBe('Dash took 1 item off the list "Gifts": Dune.');
    expect((await undoChange(deps(), off.id)).ok).toBe(true);
    expect(tables['public.inventory_item_lists']).toMatchObject([{ id: 'm1', inventory_item_id: DUNE, list_id: GIFTS }]);

    const renamed = await viaAsk('item_lists', { change: 'rename', list_ref: GIFTS, rename_to: 'Presents' });
    expect(row('item_lists', GIFTS).name).toBe('Presents');
    expect((await undoChange(deps(), renamed.id)).ok).toBe(true);
    expect(row('item_lists', GIFTS).name).toBe('Gifts');
  });

  it("refuses another person's item and a list they do not have", async () => {
    expect(await refused('item_lists', { change: 'add', list: 'Gifts', item_refs: [THEIRS] })).toContain('not items of theirs');
    expect(await refused('item_lists', { change: 'remove', list: 'Nope', item_refs: [DUNE] })).toContain('no list called');
    expect(tables['public.inventory_item_lists']).toHaveLength(0);
  });
});

describe('a change the connector made', () => {
  it("is recorded as a routine's and undone by Ask's rule, putting every row back", async () => {
    const result = await made('change_item', { item_ref: CATAN, name: 'Catan Deluxe' });
    const client = fakeSchemaDb(tables);
    const id = await recordDashAction(
      { userId: ME, core: client('core'), db: async (schema) => client(schema) },
      {
        surface: 'routine',
        kind: result.kind,
        subjectRef: result.subjectRef,
        op: result.op,
        summary: result.summary,
        beforeValues: result.before,
        undo: result.undo as unknown as Record<string, unknown>,
      },
    );
    expect(undoneByAsk({ surface: 'routine', kind: 'change_item' })).toBe(true);
    expect(undoneByAsk({ surface: 'routine', kind: 'save_story' })).toBe(false);

    expect(await undoChange(deps(), id!)).toMatchObject({ ok: true, change: { status: 'undone' } });
    expect([row('inventory_items', CATAN).name, row('inventory_items', CATAN_TWO).name]).toEqual(['Catan', 'Catan']);
  });
});

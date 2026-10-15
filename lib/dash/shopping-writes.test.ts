import { beforeEach, describe, expect, it, vi, onTestFinished } from 'vitest';
import { undoChange, type ChangeDeps } from '@/lib/ask/changes';
import { changeSentence } from '@/lib/ask/change-view';
import type { AskSchema } from '@/lib/ask/db';
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
const NETFLIX = '00000000-0000-4000-8000-00000000a001';
const APPLE = '00000000-0000-4000-8000-00000000a002';
const APPLE_TV = '00000000-0000-4000-8000-00000000a003';
const PAYMENT_THEIRS = '00000000-0000-4000-8000-00000000a004';
const SAM = '00000000-0000-4000-8000-00000000b001';

function payment(id: string, payee: string, key: string): Record<string, unknown> {
  return {
    id,
    user_id: ME,
    payee,
    payee_key: key,
    sender_domain: null,
    kind: 'subscription',
    amount_cents: 999,
    currency: 'USD',
    period: 'month',
    next_date: null,
    status: 'active',
    last_charged_on: null,
  };
}

function charge(id: string, paymentId: string, on: string, cents: number): Record<string, unknown> {
  return {
    id,
    user_id: ME,
    payment_id: paymentId,
    event: 'charge',
    amount_cents: cents,
    previous_amount_cents: null,
    currency: 'USD',
    period: 'month',
    occurred_on: on,
    due_on: null,
    created_at: `${on}T00:00:00Z`,
  };
}
const GROUP = '00000000-0000-4000-8000-00000000a001';
const GIFTS = '00000000-0000-4000-8000-00000000b001';
const SAVED_ONE = '00000000-0000-4000-8000-00000000c001';
const SAVED_THEIRS = '00000000-0000-4000-8000-00000000c002';

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
    'public.merchants': [
      { id: 'm-amazon', slug: 'amazon', name: 'Amazon', domains: ['amazon.com'], is_global: true, created_by_user_id: null, default_return_window_days: 30 },
      { id: 'm-theirs', slug: 'corner-shop-00000000', name: 'Corner Shop', domains: [], is_global: false, created_by_user_id: SOMEONE, default_return_window_days: 7 },
    ],
    'public.saved_items': [
      {
        id: SAVED_ONE,
        user_id: ME,
        merchant_id: null,
        url: 'https://shop.example/lamp',
        title: 'Desk lamp',
        image_url: null,
        price_cents: 4500,
        currency: 'USD',
        notes: null,
        status: 'saved',
        fingerprint_loose: 'desk lamp',
      },
      { id: SAVED_THEIRS, user_id: SOMEONE, url: 'https://shop.example/x', title: 'Theirs', status: 'saved' },
    ],
    'public.recurring_payments': [
      payment(NETFLIX, 'Netflix', 'netflix'),
      payment(APPLE, 'Apple', 'apple'),
      payment(APPLE_TV, 'Apple TV+', 'appletv'),
      { ...payment(PAYMENT_THEIRS, 'Netflix', 'netflix'), user_id: SOMEONE },
    ],
    'public.recurring_charges': [
      charge('ch-n1', NETFLIX, '2026-08-01', 1599),
      charge('ch-n2', NETFLIX, '2026-09-01', 1599),
      charge('ch-a1', APPLE, '2026-08-05', 999),
      charge('ch-a2', APPLE, '2026-09-05', 299),
      charge('ch-t1', APPLE_TV, '2026-07-05', 999),
    ],
    'public.recurring_payee_aliases': [],
    'public.merchant_return_policies': [],
    'public.merchant_exclusions': [],
    'public.orders': [],
    'core.email_accounts': [],
    'core.people': [{ id: SAM, user_id: ME, name: 'Sam', colour: 'brand', is_default: true }],
  };
});

const env = () => {
  const client = fakeSchemaDb(tables);
  return { userId: ME, shop: client('public'), db: async (schema: AskSchema) => client(schema) };
};
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
    // The fixtures' today; the write reads the clock, which moves on (both failed on 15 October).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
    onTestFinished(() => vi.useRealTimers());
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

describe('change_saved_item', () => {
  it('saves a product for later, matching its merchant, and Undo takes it away', async () => {
    const kept = await viaAsk('change_saved_item', { change: 'add', url: 'https://www.amazon.com/dp/B0', title: 'Kettle', price: 39.5 });
    const saved = tables['public.saved_items'].find((r) => r.title === 'Kettle')!;
    expect(saved).toMatchObject({ user_id: ME, status: 'saved', price_cents: 3950, currency: 'USD', merchant_id: 'm-amazon' });
    expect(lastSummary()).toBe('Dash saved "Kettle" for later from Amazon.');
    expect((await undoChange(deps(), kept.id)).ok).toBe(true);
    expect(tables['public.saved_items'].some((r) => r.title === 'Kettle')).toBe(false);
  });

  it('edits, marks bought, puts aside and restores, each undone', async () => {
    const edit = await viaAsk('change_saved_item', { change: 'edit', saved_ref: SAVED_ONE, title: 'Brass desk lamp', price: 52 });
    expect(row('saved_items', SAVED_ONE)).toMatchObject({ title: 'Brass desk lamp', price_cents: 5200 });
    expect(lastSummary()).toBe('Dash changed the saved item "Desk lamp": title and price.');
    expect((await undoChange(deps(), edit.id)).ok).toBe(true);
    expect(row('saved_items', SAVED_ONE)).toMatchObject({ title: 'Desk lamp', price_cents: 4500 });

    const bought = await viaAsk('change_saved_item', { change: 'bought', saved_ref: SAVED_ONE });
    expect(row('saved_items', SAVED_ONE).status).toBe('purchased');
    expect((await undoChange(deps(), bought.id)).ok).toBe(true);
    expect(row('saved_items', SAVED_ONE).status).toBe('saved');

    await viaAsk('change_saved_item', { change: 'dismiss', saved_ref: SAVED_ONE });
    expect(row('saved_items', SAVED_ONE).status).toBe('dismissed');
    await viaAsk('change_saved_item', { change: 'restore', saved_ref: SAVED_ONE });
    expect(row('saved_items', SAVED_ONE).status).toBe('saved');
  });

  it("refuses another person's saved item, a no-op, and a bad link", async () => {
    expect(await refused('change_saved_item', { change: 'dismiss', saved_ref: SAVED_THEIRS })).toMatch(/no saved item of theirs/);
    expect(await refused('change_saved_item', { change: 'restore', saved_ref: SAVED_ONE })).toMatch(/already/);
    expect(await refused('change_saved_item', { change: 'edit', saved_ref: SAVED_ONE })).toMatch(/Nothing there differs/);
    expect(await refused('change_saved_item', { change: 'add', url: 'not a link', title: 'X' })).toMatch(/full product link/);
  });
});

const ORDER = '00000000-0000-4000-8000-0000000e0001';
const ORDER_TWO = '00000000-0000-4000-8000-0000000e0002';
const ORDER_THEIRS = '00000000-0000-4000-8000-0000000e0003';
const LINE = '00000000-0000-4000-8000-0000000e0101';
const LINE_THEIRS = '00000000-0000-4000-8000-0000000e0102';
const WAITING = '00000000-0000-4000-8000-0000000e0201';
const SHIPPED = '00000000-0000-4000-8000-0000000e0202';
const GIFT_TAG = '00000000-0000-4000-8000-0000000e0301';

describe('the order writes (plan #1894.5.4)', () => {
  const order = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    user_id: ME,
    merchant_id: 'm-amazon',
    order_date: '2026-10-01',
    needs_review: true,
    deleted_at: null,
    cancelled_at: null,
    external_order_number: null,
    ...extra,
  });
  const message = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    classification: 'order_confirmation',
    parse_status: 'needs_review',
    resulting_order_id: null,
    error: null,
    parse_confidence: null,
    ...extra,
  });

  beforeEach(() => {
    tables['public.merchants'][0].is_global = true;
    tables['public.orders'] = [order(ORDER), order(ORDER_TWO, { order_date: '2026-10-02' }), order(ORDER_THEIRS, { user_id: SOMEONE })];
    tables['public.order_items'] = [
      { id: LINE, order_id: ORDER, name: 'Desk lamp' },
      { id: LINE_THEIRS, order_id: ORDER_THEIRS, name: 'Not mine' },
    ];
    tables['public.order_item_tags'] = [];
    tables['public.item_tags'] = [{ id: GIFT_TAG, user_id: ME, name: 'gift', slug: 'gift' }];
    tables['public.shipments'] = [];
    const waiting = message(WAITING, { subject: 'Your Amazon order' });
    const shipped = message(SHIPPED, { classification: 'shipping', subject: 'Your parcel has shipped' });
    tables['public.ingested_messages'] = [waiting, shipped];
    // The view carries the owner the verdict rows do not; the fake keeps it as rows of its own.
    tables['public.inbox_messages'] = [
      { ...waiting, user_id: ME },
      { ...shipped, user_id: ME, email_account_id: 'acct', provider_message_id: 'g1', received_at: '2026-10-03T10:00:00Z' },
    ];
  });

  it('adds an order with a unit per thing bought, and Undo takes it away', async () => {
    const kept = await viaAsk('add_order', {
      merchant: 'amazon',
      order_date: '2026-10-10',
      tax: 1,
      lines: [{ name: 'Mug', quantity: 2, unit_price: 8 }],
    });
    const added = tables['public.orders'].find((r) => r.order_date === '2026-10-10')!;
    expect(added).toMatchObject({ user_id: ME, merchant_id: 'm-amazon', source: 'manual', total_cents: 1700 });
    expect(tables['public.inventory_items'].filter((r) => r.name === 'Mug')).toHaveLength(2);
    expect(lastSummary()).toBe('Dash added an order from Amazon of 2026-10-10 for $17.00, with 2 items in the inventory.');
    expect((await undoChange(deps(), kept.id)).ok).toBe(true);
    expect(tables['public.orders'].some((r) => r.id === added.id)).toBe(false);
  });

  it('keeps an added order once something hangs off it, and saves a receipt or a waiting email as its source', async () => {
    const kept = await viaAsk('add_order', { merchant: 'Bakery Co', from_receipt: true, lines: [{ name: 'Bread', unit_price: 3 }] });
    const added = tables['public.orders'].find((r) => r.source === 'receipt_photo')!;
    expect(tables['public.merchants'].some((m) => m.name === 'Bakery Co' && m.created_by_user_id === ME)).toBe(true);
    tables['public.shipments'].push({ id: 'ship-1', order_id: added.id });
    expect(await undoChange(deps(), kept.id)).toMatchObject({ ok: false });
    expect(tables['public.orders'].some((r) => r.id === added.id)).toBe(true);

    const fromEmail = await viaAsk('add_order', { merchant: 'Amazon', message_ref: WAITING, lines: [{ name: 'Lamp', unit_price: 40 }] });
    expect(row('ingested_messages', WAITING)).toMatchObject({ parse_status: 'parsed' });
    expect((await undoChange(deps(), fromEmail.id)).ok).toBe(true);
    expect(row('ingested_messages', WAITING)).toMatchObject({ parse_status: 'needs_review', resulting_order_id: null });
  });

  it('tags an order line, making the tag, and Undo takes both away; untagging is undone too', async () => {
    const kept = await viaAsk('order_item_tags', { change: 'add', order_item_ref: LINE, tag: 'Office' });
    const office = tables['public.item_tags'].find((t) => t.slug === 'office')!;
    expect(tables['public.order_item_tags']).toEqual([expect.objectContaining({ order_item_id: LINE, tag_id: office.id })]);
    expect((await undoChange(deps(), kept.id)).ok).toBe(true);
    expect(tables['public.order_item_tags']).toEqual([]);
    expect(tables['public.item_tags'].some((t) => t.slug === 'office')).toBe(false);

    await viaAsk('order_item_tags', { change: 'add', order_item_ref: LINE, tag: 'gift' });
    const off = await viaAsk('order_item_tags', { change: 'remove', order_item_ref: LINE, tag: 'gift' });
    expect(tables['public.order_item_tags']).toEqual([]);
    expect((await undoChange(deps(), off.id)).ok).toBe(true);
    expect(tables['public.order_item_tags']).toEqual([expect.objectContaining({ tag_id: GIFT_TAG })]);
  });

  it('confirms, discards and restores orders in the queue, each undone', async () => {
    const confirmed = await viaAsk('review_orders', { move: 'confirm', order_refs: [ORDER, ORDER_TWO] });
    expect([row('orders', ORDER).needs_review, row('orders', ORDER_TWO).needs_review]).toEqual([false, false]);
    expect(lastSummary()).toBe('Dash confirmed 2 orders: the Amazon order of 2026-10-01 and the Amazon order of 2026-10-02.');
    expect((await undoChange(deps(), confirmed.id)).ok).toBe(true);
    expect(row('orders', ORDER).needs_review).toBe(true);

    row('ingested_messages', WAITING).resulting_order_id = ORDER;
    tables['public.inbox_messages'].find((m) => m.id === WAITING)!.resulting_order_id = ORDER;
    const discarded = await viaAsk('review_orders', { move: 'discard', order_refs: [ORDER] });
    expect(row('orders', ORDER).deleted_at).not.toBeNull();
    expect(row('ingested_messages', WAITING)).toMatchObject({ parse_status: 'skipped', resulting_order_id: null });
    expect((await undoChange(deps(), discarded.id)).ok).toBe(true);
    expect(row('orders', ORDER)).toMatchObject({ deleted_at: null, needs_review: true });
    expect(row('ingested_messages', WAITING)).toMatchObject({ parse_status: 'needs_review', resulting_order_id: ORDER });

    row('orders', ORDER_TWO).deleted_at = '2026-10-05T00:00:00Z';
    await viaAsk('review_orders', { move: 'restore', order_refs: [ORDER_TWO] });
    expect(row('orders', ORDER_TWO).deleted_at).toBeNull();
  });

  it('dismisses a waiting email and puts it back', async () => {
    const dismissed = await viaAsk('review_orders', { move: 'dismiss', message_refs: [WAITING] });
    expect(row('ingested_messages', WAITING)).toMatchObject({ parse_status: 'skipped', error: 'Dismissed from review queue' });
    expect(lastSummary()).toBe('Dash dismissed 1 email from the review queue: Your Amazon order.');
    expect((await undoChange(deps(), dismissed.id)).ok).toBe(true);
    expect(row('ingested_messages', WAITING)).toMatchObject({ parse_status: 'needs_review', error: null });
  });

  it('attaches a shipping email to its order, writing the shipment, and Undo takes it back to the queue', async () => {
    const kept = await viaAsk('review_orders', { move: 'attach', message_ref: SHIPPED, order_ref: ORDER });
    expect(row('ingested_messages', SHIPPED)).toMatchObject({ parse_status: 'parsed', resulting_order_id: ORDER });
    expect(tables['public.shipments']).toHaveLength(1);
    expect(lastSummary()).toBe('Dash attached the shipping email "Your parcel has shipped" to the Amazon order of 2026-10-01.');
    expect((await undoChange(deps(), kept.id)).ok).toBe(true);
    expect(row('ingested_messages', SHIPPED)).toMatchObject({ parse_status: 'needs_review', resulting_order_id: null });
    expect(tables['public.shipments']).toHaveLength(0);
  });

  it("refuses another person's order or line, and a move with nothing to move", async () => {
    expect(await refused('review_orders', { move: 'confirm', order_refs: [ORDER_THEIRS] })).toMatch(/not orders of theirs/);
    expect(await refused('review_orders', { move: 'restore', order_refs: [ORDER] })).toMatch(/None of those is deleted/);
    expect(await refused('review_orders', { move: 'undismiss', message_refs: [WAITING] })).toMatch(/None of those was dismissed/);
    expect(await refused('add_order', { lines: [] })).toMatch(/at least one/);
    expect(await refused('order_item_tags', { change: 'add', order_item_ref: LINE_THEIRS, tag: 'gift' })).toMatch(/no order line of theirs/);
  });
});

describe('change_recurring', () => {
  it('renames a payment by the name it shows under, and Undo puts the name back', async () => {
    const kept = await viaAsk('change_recurring', { change: 'rename', payment: 'netflix', rename_to: 'Netflix Premium' });
    expect(row('recurring_payments', NETFLIX).payee).toBe('Netflix Premium');
    expect(row('recurring_payments', PAYMENT_THEIRS).payee).toBe('Netflix');
    expect(lastSummary()).toBe('Dash renamed the recurring payment "Netflix" to "Netflix Premium".');
    expect((await undoChange(deps(), kept.id)).ok).toBe(true);
    expect(row('recurring_payments', NETFLIX).payee).toBe('Netflix');
  });

  it('leaves a payment out of the total and counts it again, each undone', async () => {
    const out = await viaAsk('change_recurring', { change: 'leave_out', payment: 'Netflix' });
    expect(row('recurring_payments', NETFLIX).status).toBe('ignored');
    expect(lastSummary()).toBe('Dash left the recurring payment "Netflix" out of the monthly total.');
    expect((await undoChange(deps(), out.id)).ok).toBe(true);
    expect(row('recurring_payments', NETFLIX).status).toBe('active');

    row('recurring_payments', APPLE).status = 'ignored';
    const back = await viaAsk('change_recurring', { change: 'count', payment: 'Apple' });
    expect(row('recurring_payments', APPLE).status).toBe('active');
    expect((await undoChange(deps(), back.id)).ok).toBe(true);
    expect(row('recurring_payments', APPLE).status).toBe('ignored');
  });

  it('merges one payment into another and records it with no Undo', async () => {
    const kept = await viaAsk('change_recurring', { change: 'merge', payment: 'Apple TV+', into: 'Apple' });
    expect(tables['public.recurring_payments'].some((r) => r.id === APPLE_TV)).toBe(false);
    expect(tables['public.recurring_charges'].find((r) => r.id === 'ch-t1')!.payment_id).toBe(APPLE);
    expect(tables['public.recurring_payee_aliases']).toMatchObject([{ user_id: ME, payee_key: 'appletv', payment_id: APPLE }]);
    expect(lastSummary()).toBe('Dash merged the recurring payment "Apple TV+" into "Apple", moving its charges there.');
    expect(tables['core.dash_actions'].at(-1)?.undo).toMatchObject({ none: expect.stringContaining('There is no Undo') });
    expect(await undoChange(deps(), kept.id)).toMatchObject({ ok: false });
  });

  it('moves charges named by their day to a new payment', async () => {
    await viaAsk('change_recurring', { change: 'move', payment: 'Apple', charged_on: ['2026-09-05'], new_payee: 'iCloud' });
    const made = tables['public.recurring_payments'].find((r) => r.payee === 'iCloud')!;
    expect(made).toMatchObject({ user_id: ME, payee_key: 'icloud' });
    expect(tables['public.recurring_charges'].find((r) => r.id === 'ch-a2')!.payment_id).toBe(made.id);
    expect(lastSummary()).toBe('Dash moved one charge from the recurring payment "Apple" to a new payment, "iCloud".');
  });

  it('refuses a payment they do not have, listing theirs, and a day with no charge, listing its charges', async () => {
    expect(await refused('change_recurring', { change: 'rename', payment: 'Spotify', rename_to: 'x' })).toBe(
      'They have no recurring payment called "Spotify". Theirs are "Netflix", "Apple", "Apple TV+".',
    );
    expect(await refused('change_recurring', { change: 'move', payment: 'Apple', charged_on: ['2026-01-01'], into: 'Netflix' })).toContain(
      'Its charges are $9.99 on 2026-08-05, $2.99 on 2026-09-05.',
    );
  });
});

describe('return_window', () => {
  it("sets a shop's window as their own, and Undo takes it back to the default", async () => {
    const kept = await viaAsk('return_window', { shop: 'amazon', days: 60 });
    expect(tables['public.merchant_return_policies']).toMatchObject([{ user_id: ME, merchant_id: 'm-amazon', return_window_days: 60 }]);
    expect(lastSummary()).toBe("Dash set Amazon's return window to a 60-day return window.");
    expect((await undoChange(deps(), kept.id)).ok).toBe(true);
    expect(tables['public.merchant_return_policies']).toHaveLength(0);
  });

  it('changes a window they set and goes back to the default without deleting', async () => {
    await viaAsk('return_window', { shop: 'Amazon', days: 60 });
    const back = await viaAsk('return_window', { shop: 'Amazon', use_default: true });
    expect(tables['public.merchant_return_policies']).toMatchObject([{ return_window_days: 30 }]);
    expect(lastSummary()).toBe("Dash set Amazon's return window to the default, a 30-day return window.");
    expect((await undoChange(deps(), back.id)).ok).toBe(true);
    expect(tables['public.merchant_return_policies']).toMatchObject([{ return_window_days: 60 }]);
  });

  it("adds a shop of their own only when asked, and never names another account's", async () => {
    expect(await refused('return_window', { shop: 'Corner Shop', days: 14 })).toMatch(/no shop called "Corner Shop".*new_shop true/);
    const kept = await viaAsk('return_window', { shop: 'Corner Shop', days: 14, new_shop: true });
    const made = tables['public.merchants'].find((m) => m.created_by_user_id === ME)!;
    expect(made).toMatchObject({ name: 'Corner Shop', is_global: false, default_return_window_days: 14 });
    expect(made.slug).toBe(`corner-shop-${ME.slice(0, 8)}`);
    expect((await undoChange(deps(), kept.id)).ok).toBe(true);
    expect(tables['public.merchants'].some((m) => m.created_by_user_id === ME)).toBe(false);
  });

  it('refuses a window it has already and a bad number', async () => {
    expect(await refused('return_window', { shop: 'Amazon', days: 30 })).toBe('Amazon has a 30-day return window already.');
    expect(await refused('return_window', { shop: 'Amazon', days: 0 })).toMatch(/1 to 730/);
  });
});

describe('change_person', () => {
  const people = () => tables['core.people'];

  it('adds someone they shop for, and Undo takes them off while nothing is on them', async () => {
    const kept = await viaAsk('change_person', { change: 'add', name: 'Alex', colour: 'green' });
    expect(people().find((p) => p.name === 'Alex')).toMatchObject({ user_id: ME, colour: 'green', is_default: false });
    expect(lastSummary()).toBe('Dash added Alex to the people they shop for in Shopping.');
    expect((await undoChange(deps(), kept.id)).ok).toBe(true);
    expect(people().some((p) => p.name === 'Alex')).toBe(false);

    const again = await viaAsk('change_person', { change: 'add', name: 'Alex' });
    const alex = people().find((p) => p.name === 'Alex')!;
    tables['public.orders'].push({ id: 'o-1', user_id: ME, person_id: alex.id });
    expect(await undoChange(deps(), again.id)).toMatchObject({ ok: false, error: expect.stringContaining('Dash kept it') });
  });

  it('renames and recolours someone, and Undo puts them back', async () => {
    const kept = await viaAsk('change_person', { change: 'edit', person: 'sam', rename_to: 'Samantha', colour: 'pink' });
    expect(people()[0]).toMatchObject({ name: 'Samantha', colour: 'pink' });
    expect(lastSummary()).toBe('Dash changed Sam in the people they shop for: renamed them Samantha and gave them the colour pink.');
    expect((await undoChange(deps(), kept.id)).ok).toBe(true);
    expect(people()[0]).toMatchObject({ name: 'Sam', colour: 'brand' });
  });

  it('refuses a name already on the list and someone not on it', async () => {
    expect(await refused('change_person', { change: 'add', name: 'SAM' })).toBe('SAM is on their list of people already.');
    expect(await refused('change_person', { change: 'edit', person: 'Jo', colour: 'pink' })).toBe(
      'There is nobody called Jo on their list. The people they shop for are Sam.',
    );
  });
});

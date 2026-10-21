import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AskSchema } from '@/lib/ask/db';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import type { DashWriteResult } from './registry';
import { SHOPPING_WRITES, runShoppingWrite } from './shopping-writes';
import { WRITE_TOOLS } from './writes';

/**
 * Each Shopping tool against the button it matches (plan #2473.4): the same
 * request, once pressed on the page and once asked of Dash, over two copies
 * of the same rows, leaves the same rows behind. lib/dash/runs.test.ts checks
 * that both reach the same function; this checks what that function wrote.
 */

const ME = '00000000-0000-4000-8000-0000000000cc';
const SAM = '00000000-0000-4000-8000-00000000b001';
const AMAZON = '00000000-0000-4000-8000-00000000e001';
const CORNER = '00000000-0000-4000-8000-00000000e002';
const CORNER_POLICY = '00000000-0000-4000-8000-00000000e003';
const ORDER = '00000000-0000-4000-8000-00000000c001';
const LINE = '00000000-0000-4000-8000-00000000c002';
const GIFT_TAG = '00000000-0000-4000-8000-00000000c003';
const LAMP = '00000000-0000-4000-8000-00000000f001';
const CATAN = '00000000-0000-4000-8000-00000000f002';
const CATAN_TWO = '00000000-0000-4000-8000-00000000f003';
const GROUP = '00000000-0000-4000-8000-00000000f004';
const SAVED_LAMP = '00000000-0000-4000-8000-00000000d001';
const KEEP = '00000000-0000-4000-8000-00000000d002';
const DUNE = '00000000-0000-4000-8000-00000000f005';
const BOOKS = '00000000-0000-4000-8000-00000000a101';
const GAMES = '00000000-0000-4000-8000-00000000a102';
const KITCHEN = '00000000-0000-4000-8000-00000000a103';
const WAITING_ORDER = '00000000-0000-4000-8000-00000000c004';
const GONE_ORDER = '00000000-0000-4000-8000-00000000c005';
const WAITING_EMAIL = '00000000-0000-4000-8000-00000000c006';
const SOURCE_EMAIL = '00000000-0000-4000-8000-00000000c007';

/** The rows the page's clients see; swapped per run. */
let live: FakeTables = {};

vi.mock('next/cache', () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock('@/lib/auth/server', () => ({
  requireUser: async () => ({ id: ME, email: 'me@example.com' }),
  getUser: async () => ({ id: ME, email: 'me@example.com' }),
  createClient: async () => fakeSchemaDb(live)('public'),
}));
vi.mock('@/lib/core/auth/server', () => ({ createCoreClient: async () => fakeSchemaDb(live)('core') }));

function unit(id: string, name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
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
    cost_cents: null,
    disposed_at: null,
    disposal_method: null,
    disposal_proceeds_cents: null,
    variant: null,
    notes: null,
    category_id: null,
    attributes: {},
    search_tags: [],
    manual_expected_price_cents: null,
    ...extra,
  };
}

function email(id: string, status: string, orderId: string | null): Record<string, unknown> {
  return { id, classification: 'order_confirmation', parse_status: status, resulting_order_id: orderId, error: null, subject: 'Your order' };
}

function fixture(): FakeTables {
  return {
    'core.dash_actions': [],
    'core.people': [{ id: SAM, user_id: ME, name: 'Sam', colour: 'brand', is_default: true }],
    'public.merchants': [
      { id: AMAZON, slug: 'amazon', name: 'Amazon', domains: ['amazon.com'], is_global: true, created_by_user_id: null, default_return_window_days: 30 },
      { id: CORNER, slug: 'corner-shop-00000000', name: 'Corner Shop', domains: [], is_global: false, created_by_user_id: ME, default_return_window_days: 7 },
    ],
    'public.merchant_return_policies': [{ id: CORNER_POLICY, user_id: ME, merchant_id: CORNER, return_window_days: 10 }],
    'public.orders': [
      { id: ORDER, user_id: ME, merchant_id: AMAZON, order_date: '2026-10-01', needs_review: false, deleted_at: null },
      { id: WAITING_ORDER, user_id: ME, merchant_id: AMAZON, order_date: '2026-10-02', needs_review: true, deleted_at: null },
      { id: GONE_ORDER, user_id: ME, merchant_id: AMAZON, order_date: '2026-09-02', needs_review: false, deleted_at: '2026-10-01T00:00:00Z' },
    ],
    'public.ingested_messages': [email(WAITING_EMAIL, 'needs_review', null), email(SOURCE_EMAIL, 'parsed', WAITING_ORDER)],
    // The view carries the owner the verdict rows do not; the fake keeps it as rows of its own.
    'public.inbox_messages': [
      { ...email(WAITING_EMAIL, 'needs_review', null), user_id: ME },
      { ...email(SOURCE_EMAIL, 'parsed', WAITING_ORDER), user_id: ME },
    ],
    // The page reads the line through its order (orders!inner), which the fake keeps as a column of the line.
    'public.order_items': [{ id: LINE, order_id: ORDER, name: 'Desk lamp', 'orders.user_id': ME }],
    'public.item_tags': [{ id: GIFT_TAG, user_id: ME, name: 'gift', slug: 'gift' }],
    'public.order_item_tags': [],
    'public.profiles': [{ id: ME, timezone: 'UTC' }],
    'public.inventory_items': [
      unit(LAMP, 'Desk lamp', { cost_cents: 4500, order_item_id: LINE }),
      unit(CATAN, 'Catan', { group_id: GROUP }),
      unit(CATAN_TWO, 'Catan', { group_id: GROUP }),
      unit(DUNE, 'Dune', { notes: 'Signed copy' }),
    ],
    'public.categories': [
      { id: BOOKS, user_id: null, slug: 'books', name: 'Books' },
      { id: GAMES, user_id: null, slug: 'board-games', name: 'Board games' },
      { id: KITCHEN, user_id: null, slug: 'kitchen', name: 'Kitchen' },
    ],
    'public.book_details': [
      { id: 'dune-details', inventory_item_id: DUNE, isbn_13: null, condition: null, needs_confirmation: true, candidates: [{ title: 'Dune (1965)' }], confirmation_reason: 'Two editions match.', manual_expected_price_cents: null },
    ],
    'public.game_details': [
      { id: 'catan-details', inventory_item_id: CATAN, bgg_id: 13, condition: null, needs_confirmation: true, candidates: [{ title: 'Catan (1995)' }], confirmation_reason: 'Two match.', manual_expected_price_cents: null },
    ],
    'public.item_groups': [{ id: GROUP, user_id: ME, name: 'Catan', group_key: 'catan' }],
    'public.item_lists': [{ id: KEEP, user_id: ME, name: 'Keep', slug: 'keep', color: null }],
    'public.inventory_item_lists': [],
    'public.saved_items': [
      {
        id: SAVED_LAMP,
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
    ],
    'public.returns': [],
  };
}

let page: FakeTables;
let dash: FakeTables;

beforeEach(() => {
  page = fixture();
  dash = fixture();
  // A new list takes a gradient at random (pickListGradient); the same one on both runs.
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

/** Presses the button over the page's copy of the rows. */
async function press<T>(button: () => Promise<T>): Promise<T> {
  live = page;
  return button();
}

/** Asks Dash over its copy of the rows. */
async function ask(name: string, input: Record<string, unknown>): Promise<void> {
  const client = fakeSchemaDb(dash);
  const write = SHOPPING_WRITES.find((entry) => entry.name === name)!;
  const result = await runShoppingWrite(write, { userId: ME, shop: client('public'), db: async (schema: AskSchema) => client(schema) }, input);
  if ('ok' in result) throw new Error(result.error);
}

/** Runs one of the free tools in lib/dash/writes.ts over Dash's copy of the rows. */
async function apply(name: string, input: Record<string, unknown>): Promise<void> {
  const client = fakeSchemaDb(dash);
  const tool = WRITE_TOOLS.find((entry) => entry.name === name)!;
  const result = (await tool.apply(
    {
      userId: ME,
      today: '2026-10-14',
      timezone: 'UTC',
      enabledModules: ['shopping'],
      db: async (schema) => client(schema),
      searchSources: [],
      seen: () => true,
      goals: async () => client('goals') as unknown as GoalsSupabaseClient,
      createTask: async () => ({ id: null, error: 'unused' }),
    },
    input,
  )) as DashWriteResult;
  if (!result.ok) throw new Error(result.error);
}

/** Clock times, which differ between two runs by chance. */
const CLOCK = /(_at|_on)$/;
/** An id, of a row the fixture has or of a new one: the fake's (tests/stubs/fake-schema-db.ts) or a randomUUID's, different on each run. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KNOWN = new Set(Object.values(fixture()).flatMap((rows) => rows.map((row) => row.id)));
const isNew = (value: unknown) => typeof value === 'string' && UUID.test(value) && !KNOWN.has(value);

/** A table's rows without what differs between two runs by chance, in a fixed order. */
function settled(tables: FakeTables, table: string): Record<string, unknown>[] {
  return (tables[table] ?? [])
    .map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          CLOCK.test(key) && value != null ? 'a time' : isNew(value) ? 'a new id' : value,
        ]),
      ),
    )
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function expectSame(...tableNames: string[]): void {
  for (const table of tableNames) expect(settled(dash, table), table).toEqual(settled(page, table));
}

describe('change_person and the people settings', () => {
  it('adds the same person', async () => {
    const { addPerson } = await import('@/app/shopping/settings/people-actions');
    expect(await press(() => addPerson({}, form({ name: 'Alex', colour: 'green' })))).toEqual({ message: 'Alex added.' });
    await ask('change_person', { change: 'add', name: 'Alex', colour: 'green' });
    expectSame('core.people');
  });

  it('renames and recolours the same way', async () => {
    const { updatePerson } = await import('@/app/shopping/settings/people-actions');
    expect(await press(() => updatePerson({ personId: SAM, name: 'Samantha', colour: 'pink' }))).toEqual({ error: null });
    await ask('change_person', { change: 'edit', person: 'Sam', rename_to: 'Samantha', colour: 'pink' });
    expectSame('core.people');
  });
});

function form(values: Record<string, string>): FormData {
  const out = new FormData();
  for (const [key, value] of Object.entries(values)) out.set(key, value);
  return out;
}

describe('return_window and the return windows in settings', () => {
  it("sets a shop's window as their own", async () => {
    const { saveMerchantReturnPolicy } = await import('@/app/shopping/returns/actions');
    expect(await press(() => saveMerchantReturnPolicy({}, form({ merchant_id: AMAZON, return_window_days: '60' })))).toEqual({
      message: 'Set Amazon to 60 days.',
    });
    await ask('return_window', { shop: 'Amazon', days: 60 });
    expectSame('public.merchant_return_policies', 'public.merchants');
  });

  it('changes a window they set before', async () => {
    const { saveMerchantReturnPolicy } = await import('@/app/shopping/returns/actions');
    await press(() => saveMerchantReturnPolicy({}, form({ merchant_id: CORNER, return_window_days: '21' })));
    await ask('return_window', { shop: 'Corner Shop', days: 21 });
    expectSame('public.merchant_return_policies');
  });

  it('adds a shop of their own with its window', async () => {
    const { createMerchantReturnPolicy } = await import('@/app/shopping/returns/actions');
    expect(await press(() => createMerchantReturnPolicy({}, form({ name: 'Bike Hut', return_window_days: '14' })))).toEqual({
      message: 'Added Bike Hut with a 14-day window.',
    });
    await ask('return_window', { shop: 'Bike Hut', days: 14, new_shop: true });
    expectSame('public.merchants', 'public.merchant_return_policies');
  });
});

describe("order_item_tags and the order page's tag chips", () => {
  it('tags a line, making the tag', async () => {
    const { addOrderItemTag } = await import('@/app/shopping/orders/actions');
    await press(() => addOrderItemTag(form({ orderId: ORDER, orderItemId: LINE, tag: 'Office' })));
    expect(page['public.order_item_tags']).toHaveLength(1);
    await ask('order_item_tags', { change: 'add', order_item_ref: LINE, tag: 'Office' });
    expectSame('public.item_tags', 'public.order_item_tags');
  });

  it('takes a tag off a line', async () => {
    for (const tables of [page, dash]) tables['public.order_item_tags'].push({ id: 'link-1', order_item_id: LINE, tag_id: GIFT_TAG });
    const { removeOrderItemTag } = await import('@/app/shopping/orders/actions');
    await press(() => removeOrderItemTag({ orderId: ORDER, orderItemId: LINE, tagId: GIFT_TAG }));
    expect(page['public.order_item_tags']).toEqual([]);
    await ask('order_item_tags', { change: 'remove', order_item_ref: LINE, tag: 'gift' });
    expectSame('public.item_tags', 'public.order_item_tags');
  });
});

describe("mark_returned and the inventory's Mark returned", () => {
  it('writes the same refunded return at what the item cost', async () => {
    const { markInventoryReturned } = await import('@/app/shopping/inventory/actions');
    expect(await press(() => markInventoryReturned({}, form({ id: LAMP, refund_amount: '' })))).toEqual({ message: 'Marked as returned.' });
    await apply('mark_returned', { item_ref: LAMP });
    expect(page['public.returns']).toHaveLength(1);
    expectSame('public.returns', 'public.inventory_items');
  });
});

/** A form with these values, and an id for each of `ids` as the bulk bar sends them. */
function picked(ids: string[], values: Record<string, string> = {}): FormData {
  const out = form(values);
  for (const id of ids) out.append('id', id);
  return out;
}

describe("change_items and the inventory's bulk bar and row buttons", () => {
  it('marks items for sale, and takes them off the sell page', async () => {
    const { setItemsForSale, toggleItemForSaleForm } = await import('@/app/shopping/inventory/actions');
    await press(() => setItemsForSale({}, picked([LAMP, CATAN], { for_sale: 'true' })));
    await apply('change_items', { change: 'for_sale', item_refs: [LAMP, CATAN] });
    expectSame('public.inventory_items');
    await press(() => toggleItemForSaleForm(picked([LAMP], { for_sale: 'false' })));
    await apply('change_items', { change: 'not_for_sale', item_refs: [LAMP] });
    expectSame('public.inventory_items');
  });

  it('marks items to return, one or many, and takes them off the list', async () => {
    const { setItemsReturnPlanned, setReturnPlanned, toggleReturnPlannedForm } = await import('@/app/shopping/returns/actions');
    await press(() => setItemsReturnPlanned({}, picked([LAMP, CATAN_TWO], { planned: 'true' })));
    await apply('change_items', { change: 'to_return', item_refs: [LAMP, CATAN_TWO] });
    expectSame('public.inventory_items');
    await press(() => setReturnPlanned({}, form({ id: LAMP, planned: 'false' })));
    await apply('change_items', { change: 'not_returning', item_refs: [LAMP] });
    expectSame('public.inventory_items');
    await press(() => toggleReturnPlannedForm(form({ id: CATAN, planned: 'true' })));
    await apply('change_items', { change: 'to_return', item_refs: [CATAN] });
    expectSame('public.inventory_items');
  });

  it('says an item was sold, with what it went for, and one thrown out', async () => {
    const { disposeInventoryItem, quickDisposeInventoryItem } = await import('@/app/shopping/inventory/actions');
    expect(await press(() => disposeInventoryItem({}, form({ id: LAMP, disposal_method: 'sold', disposal_proceeds: '12.50' })))).toEqual({
      message: 'Marked as sold.',
    });
    await apply('change_items', { change: 'dispose', item_refs: [LAMP], disposal_method: 'sold', proceeds: 12.5 });
    expectSame('public.inventory_items');
    await press(() => quickDisposeInventoryItem(form({ id: CATAN })));
    await apply('change_items', { change: 'dispose', item_refs: [CATAN], disposal_method: 'trashed' });
    expectSame('public.inventory_items');
  });

  it('separates a copy from its stack into a group of its own', async () => {
    const { separateCopy } = await import('@/app/shopping/inventory/group-actions');
    await press(() => separateCopy({}, form({ id: CATAN_TWO })));
    await apply('change_items', { change: 'separate', item_refs: [CATAN_TWO] });
    expectSame('public.inventory_items', 'public.item_groups');
  });

  it("ungroups a stack's copies; the page deletes the group, and Dash keeps it empty and keyless for Undo", async () => {
    const { ungroupItems } = await import('@/app/shopping/inventory/group-actions');
    await press(() => ungroupItems({}, form({ group_id: GROUP })));
    await apply('change_items', { change: 'ungroup', item_refs: [CATAN] });
    expectSame('public.inventory_items');
    expect(page['public.item_groups']).toEqual([]);
    expect(dash['public.item_groups']).toEqual([expect.objectContaining({ id: GROUP, group_key: null })]);
  });
});

describe('change_saved_item and the saved-for-later pages', () => {
  it('saves a product for later, matched to its shop by the link', async () => {
    const { createSavedItem } = await import('@/app/shopping/saved/actions');
    // The page goes to the new item once it is saved.
    await expect(
      press(() => createSavedItem({}, form({ url: 'https://www.amazon.com/dp/B0001', title: 'Kettle', price: '29.99', currency: 'usd', notes: ' Gift ' }))),
    ).rejects.toThrow();
    await ask('change_saved_item', { change: 'add', url: 'https://www.amazon.com/dp/B0001', title: 'Kettle', price: 29.99, currency: 'usd', notes: 'Gift' });
    expect(page['public.saved_items'].find((row) => row.title === 'Kettle')).toMatchObject({ merchant_id: AMAZON });
    expectSame('public.saved_items');
  });

  it('edits the details the same way', async () => {
    const { updateSavedItem } = await import('@/app/shopping/saved/actions');
    const edit = { id: SAVED_LAMP, url: 'https://shop.example/lamp', title: 'Brass desk lamp', price: '39.00', currency: 'USD', notes: 'Wait for the sale' };
    expect(await press(() => updateSavedItem({}, form(edit)))).toEqual({ message: 'Saved.' });
    await ask('change_saved_item', { change: 'edit', saved_ref: SAVED_LAMP, title: 'Brass desk lamp', price: 39, notes: 'Wait for the sale' });
    expectSame('public.saved_items');
  });

  it('marks it bought, puts it aside and moves it back', async () => {
    const actions = await import('@/app/shopping/saved/actions');
    const moves = [
      [actions.markSavedPurchased, 'bought'],
      [actions.dismissSavedItem, 'dismiss'],
      [actions.restoreSavedItem, 'restore'],
    ] as const;
    for (const [button, change] of moves) {
      await press(() => button({}, form({ id: SAVED_LAMP })));
      await ask('change_saved_item', { change, saved_ref: SAVED_LAMP });
      expectSame('public.saved_items');
    }
  });
});

describe("item_lists and the lists in settings and on the item page", () => {
  it('makes a list and puts an item on it', async () => {
    const { createItemListAndAssign } = await import('@/app/shopping/inventory/actions');
    expect(await press(() => createItemListAndAssign({}, form({ id: LAMP, name: 'Gifts' })))).toEqual({ message: 'Added to “Gifts”.' });
    await ask('item_lists', { change: 'add', list: 'Gifts', item_refs: [LAMP] });
    expectSame('public.item_lists', 'public.inventory_item_lists');
  });

  it("makes a list from settings as Dash's new list makes it", async () => {
    const { createItemList } = await import('@/app/shopping/settings/actions');
    await press(() => createItemList({}, form({ name: 'Gifts' })));
    await ask('item_lists', { change: 'add', list: 'Gifts', item_refs: [LAMP] });
    expectSame('public.item_lists');
  });

  it('renames a list', async () => {
    const { renameItemList } = await import('@/app/shopping/settings/actions');
    expect(await press(() => renameItemList({}, form({ id: KEEP, name: 'Keepers' })))).toEqual({ message: 'List renamed.' });
    await ask('item_lists', { change: 'rename', list: 'Keep', rename_to: 'Keepers' });
    expectSame('public.item_lists');
  });

  it("puts an item on a list and takes it off, by the row's toggle and by the checklist", async () => {
    const { toggleInventoryItemList, updateInventoryItemLists } = await import('@/app/shopping/inventory/actions');
    await press(() => toggleInventoryItemList(form({ id: LAMP, list_id: KEEP, join: 'true' })));
    await ask('item_lists', { change: 'add', list: 'Keep', item_refs: [LAMP] });
    expectSame('public.inventory_item_lists');
    await press(() => toggleInventoryItemList(form({ id: LAMP, list_id: KEEP, join: 'false' })));
    await ask('item_lists', { change: 'remove', list: 'Keep', item_refs: [LAMP] });
    expectSame('public.inventory_item_lists');
    const checklist = form({ id: CATAN });
    checklist.append('list_id', KEEP);
    await press(() => updateInventoryItemLists({}, checklist));
    await ask('item_lists', { change: 'add', list: 'Keep', item_refs: [CATAN] });
    expect(page['public.inventory_item_lists']).toHaveLength(1);
    expectSame('public.inventory_item_lists');
  });
});

describe('change_item and the item, sell and edition buttons', () => {
  it("saves a name to every copy in the stack, as the Details form does", async () => {
    const { updateInventoryItem } = await import('@/app/shopping/inventory/actions');
    const details = { id: CATAN, name: 'Catan: Cities', variant: '', category_id: '', notes: '' };
    expect(await press(() => updateInventoryItem({}, form(details)))).toEqual({ message: 'Saved to all 2 copies.' });
    await ask('change_item', { item_ref: CATAN, name: 'Catan: Cities' });
    expectSame('public.inventory_items');
  });

  it('renames the group a stack stands for', async () => {
    const { renameItemGroup } = await import('@/app/shopping/inventory/group-actions');
    expect(await press(() => renameItemGroup({}, form({ group_id: GROUP, name: 'Settlers' })))).toEqual({ message: 'Renamed.' });
    await ask('change_item', { item_ref: CATAN, group_name: 'Settlers' });
    expectSame('public.item_groups');
  });

  it("sets a book's condition and confirms its edition, and confirms a game's", async () => {
    const books = await import('@/app/shopping/inventory/book-actions');
    const games = await import('@/app/shopping/inventory/game-actions');
    await press(() => books.updateBookCondition({}, form({ inventory_item_id: DUNE, condition: 'very_good' })));
    await press(() => books.confirmBookEdition({}, form({ inventory_item_id: DUNE })));
    await ask('change_item', { item_ref: DUNE, condition: 'very_good', confirm_edition: true });
    expectSame('public.book_details');
    await press(() => games.confirmGameEdition({}, form({ inventory_item_id: CATAN })));
    await ask('change_item', { item_ref: CATAN, confirm_edition: true });
    expectSame('public.game_details');
  });

  it("adds the sell page's planning-to-list note, and sets a sell price where the sell page reads it", async () => {
    const { noteListingIntent, setSellPrice } = await import('@/app/shopping/sell/actions');
    await press(() => noteListingIntent({}, form({ id: DUNE })));
    await ask('change_item', { item_ref: DUNE, add_note: 'Planning to list myself.' });
    expectSame('public.inventory_items');
    await press(() => setSellPrice({}, form({ inventory_item_id: DUNE, price: '12.50' })));
    await press(() => setSellPrice({}, form({ inventory_item_id: LAMP, price: '30' })));
    await ask('change_item', { item_ref: DUNE, sell_price: 12.5 });
    await ask('change_item', { item_ref: LAMP, sell_price: 30 });
    expectSame('public.book_details', 'public.inventory_items');
  });
});

describe('add_items and the add pages', () => {
  /** What a new row of these was added as, without the copies the fixture has. */
  const added = (tables: FakeTables, table: string) => tables[table].filter((row) => !KNOWN.has(row.id));

  it('adds a book saved by hand', async () => {
    const { saveOwnedBook } = await import('@/app/shopping/inventory/book-actions');
    const book = {
      isbn13: null,
      isbn10: null,
      title: 'Hyperion',
      authors: ['Dan Simmons'],
      publisher: 'Bantam',
      publishedYear: 1989,
      edition: null,
      coverUrl: null,
      weightGrams: null,
      matchConfidence: 1,
      needsConfirmation: false,
      resolutionSource: 'manual',
      alternates: [],
      confirmationReason: null,
    };
    expect(await press(() => saveOwnedBook({}, form({ book_json: JSON.stringify(book) })))).toMatchObject({ message: 'Added to your library.' });
    await ask('add_items', { items: [{ kind: 'book', title: 'Hyperion', authors: ['Dan Simmons'], publisher: 'Bantam', year: 1989 }] });
    expect(added(page, 'public.book_details')).toHaveLength(1);
    expectSame('public.inventory_items', 'public.book_details');
  });

  it('adds a board game saved by hand', async () => {
    const { saveGame } = await import('@/app/shopping/inventory/game-actions');
    const game = {
      bggId: null,
      barcode: null,
      title: 'Azul',
      yearPublished: 2017,
      publisher: 'Plan B',
      minPlayers: null,
      maxPlayers: null,
      playingTimeMinutes: null,
      imageUrl: null,
      matchConfidence: 1,
      needsConfirmation: false,
      resolutionSource: 'manual',
      alternates: [],
      confirmationReason: null,
    };
    await press(() => saveGame({}, form({ game_json: JSON.stringify(game), force_confirmed: 'true' })));
    await ask('add_items', { items: [{ kind: 'game', title: 'Azul', year: 2017, publisher: 'Plan B' }] });
    expect(added(page, 'public.game_details')).toHaveLength(1);
    expectSame('public.inventory_items', 'public.game_details');
  });

  it('adds anything else typed in, filed under its category', async () => {
    const { saveManualItem } = await import('@/app/shopping/inventory/item-actions');
    const typed = { name: 'Kettle', variant: 'Steel', category_id: KITCHEN, cost: '24.99', notes: 'From the market', acquired_at: '2026-09-01' };
    expect(await press(() => saveManualItem({}, form(typed)))).toMatchObject({ message: 'Added to your inventory.' });
    await ask('add_items', {
      items: [{ kind: 'other', title: 'Kettle', variant: 'Steel', category: 'Kitchen', cost: 24.99, notes: 'From the market', acquired_on: '2026-09-01' }],
    });
    expectSame('public.inventory_items');
  });
});

describe('review_orders and the review queue, its bulk bar and Deleted orders', () => {
  it('confirms an order, one or many, and puts it back in the queue', async () => {
    const review = await import('@/app/shopping/review/actions');
    expect(await press(() => review.confirmOrderReview({}, form({ orderId: WAITING_ORDER })))).toEqual({ message: 'Order confirmed.' });
    await ask('review_orders', { move: 'confirm', order_refs: [WAITING_ORDER] });
    expectSame('public.orders');
    expect(await press(() => review.unconfirmOrdersReview([WAITING_ORDER]))).toEqual({ changed: [WAITING_ORDER] });
    await ask('review_orders', { move: 'unconfirm', order_refs: [WAITING_ORDER] });
    expectSame('public.orders');
    expect(await press(() => review.confirmOrdersReview([WAITING_ORDER]))).toEqual({ changed: [WAITING_ORDER] });
    await ask('review_orders', { move: 'confirm', order_refs: [WAITING_ORDER] });
    expectSame('public.orders');
  });

  it("discards an order, skipping the email it was read from, by the row's button", async () => {
    const { discardOrderReview } = await import('@/app/shopping/review/actions');
    // The page goes back to the queue once it is done.
    await expect(press(() => discardOrderReview({}, form({ orderId: WAITING_ORDER })))).rejects.toThrow();
    await ask('review_orders', { move: 'discard', order_refs: [WAITING_ORDER] });
    expect(page['public.ingested_messages'].find((row) => row.id === SOURCE_EMAIL)).toMatchObject({ parse_status: 'skipped' });
    expectSame('public.orders', 'public.ingested_messages');
  });

  it('discards by the bulk bar, and its undo brings the order back to the queue', async () => {
    const review = await import('@/app/shopping/review/actions');
    const discarded = await press(() => review.discardOrdersReview([WAITING_ORDER]));
    await ask('review_orders', { move: 'discard', order_refs: [WAITING_ORDER] });
    expectSame('public.orders', 'public.ingested_messages');
    expect(await press(() => review.restoreDiscardedOrders(discarded.restore))).toEqual({ changed: [WAITING_ORDER] });
    await ask('review_orders', { move: 'restore', order_refs: [WAITING_ORDER], review_again: true });
    expectSame('public.orders');
  });

  it('brings a deleted order back from Deleted orders', async () => {
    const { restoreDeletedOrder } = await import('@/app/shopping/orders/actions');
    // The page opens the order once it is back.
    await expect(press(() => restoreDeletedOrder(form({ orderId: GONE_ORDER })))).rejects.toThrow();
    await ask('review_orders', { move: 'restore', order_refs: [GONE_ORDER] });
    expect(page['public.orders'].find((row) => row.id === GONE_ORDER)).toMatchObject({ deleted_at: null });
    expectSame('public.orders');
  });

  it('dismisses a waiting email, one or many, and puts it back', async () => {
    const review = await import('@/app/shopping/review/actions');
    expect(await press(() => review.dismissEmailReview({}, form({ messageId: WAITING_EMAIL })))).toEqual({ message: 'Email dismissed.' });
    await ask('review_orders', { move: 'dismiss', message_refs: [WAITING_EMAIL] });
    expectSame('public.ingested_messages');
    // inbox_messages is a view over the verdict rows; the fake keeps it apart, so it is brought up to date here.
    for (const tables of [page, dash]) {
      for (const row of tables['public.inbox_messages']) Object.assign(row, tables['public.ingested_messages'].find((m) => m.id === row.id));
    }
    await press(() => review.restoreDismissedEmails([{ id: WAITING_EMAIL, parseStatus: 'needs_review', error: null }]));
    await ask('review_orders', { move: 'undismiss', message_refs: [WAITING_EMAIL] });
    expectSame('public.ingested_messages');
  });
});

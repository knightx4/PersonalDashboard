import { describe, expect, it } from 'vitest';
import type { PipelineRow } from '@/lib/jobs/applications/load';
import { inventoryMatches, pipelineMatches, resolveFilteredList, type InventoryCandidate } from './filtered-list';
import type { AskContext } from './db';

function item(id: string, name: string, extra: Partial<InventoryCandidate> = {}): InventoryCandidate {
  return {
    id,
    name,
    short_name: null,
    variant: null,
    cost_cents: 1000,
    acquired_at: '2026-03-04',
    search_tags: null,
    attributes: {},
    category_id: 'games',
    person_id: null,
    categories: { name: 'Games' },
    inventory_item_lists: [],
    order_items: { orders: { merchant_id: 'amazon', deleted_at: null, merchants: { name: 'Amazon' } } },
    ...extra,
  };
}

const ITEMS = [
  item('1', 'Catan'),
  item('2', 'Ticket to Ride', { attributes: { brand: 'Days of Wonder' } }),
  item('3', 'Penguin Classics', { category_id: 'books', categories: { name: 'Books' } }),
  item('4', 'Old lamp', {
    order_items: { orders: { merchant_id: 'ebay', deleted_at: null, merchants: { name: 'eBay' } } },
  }),
  item('5', 'Voided', {
    order_items: { orders: { merchant_id: 'amazon', deleted_at: '2026-04-01', merchants: { name: 'Amazon' } } },
  }),
  item('6', 'Listed', { inventory_item_lists: [{ list_id: 'wish' }] }),
];

const ids = (rows: readonly { id: string }[]) => rows.map((row) => row.id);

describe('the inventory rows a filter picks out (plan #1658)', () => {
  // The merchant and list filters read uuids on the page; these ids stand in for them.
  it('applies the category, person and attribute filters the page does', () => {
    expect(ids(inventoryMatches(ITEMS, 'category=books'))).toEqual(['3']);
    expect(ids(inventoryMatches(ITEMS, 'attr=brand%3Adays%20of%20wonder'))).toEqual(['2']);
  });

  it('applies the merchant and list filters', () => {
    expect(ids(inventoryMatches(ITEMS, 'merchant=ebay'))).toEqual(['4']);
    expect(ids(inventoryMatches(ITEMS, 'list=wish'))).toEqual(['6']);
  });

  it('leaves out an item on a deleted order, as the page does', () => {
    expect(ids(inventoryMatches(ITEMS, 'category=games'))).not.toContain('5');
  });

  it('searches by name', () => {
    expect(ids(inventoryMatches(ITEMS, 'q=catan'))).toEqual(['1']);
  });
});

const row = (id: string, status: string, extra: Partial<PipelineRow> = {}) =>
  ({
    applicationId: id,
    roleTitle: 'Analyst',
    companyName: 'Acme',
    status,
    source: 'manual',
    excitement: null,
    scoreNote: null,
    ...extra,
  }) as unknown as PipelineRow;

describe('the pipeline rows a filter picks out (plan #1658)', () => {
  const ROWS = [
    row('a', 'applied'),
    row('b', 'rejected'),
    row('c', 'applied', { source: 'linkedin', companyName: 'Globex' }),
  ];

  it('reads the status, source and search from the query as the page does', () => {
    expect(pipelineMatches(ROWS, 'status=closed').map((r) => r.applicationId)).toEqual(['b']);
    expect(pipelineMatches(ROWS, 'source=linkedin').map((r) => r.applicationId)).toEqual(['c']);
    expect(pipelineMatches(ROWS, 'q=globex').map((r) => r.applicationId)).toEqual(['c']);
    expect(pipelineMatches(ROWS, 'status=all&q=acme').map((r) => r.applicationId)).toEqual(['a', 'b']);
  });
});

describe('resolving a filter for Dash', () => {
  const ctx = (enabled: AskContext['enabledModules']) =>
    ({
      userId: 'u',
      today: '2026-10-09',
      enabledModules: enabled,
      db: async () => {
        throw new Error('no database');
      },
    }) as unknown as AskContext;

  it('says nothing about a list in a workspace that is off', async () => {
    expect(await resolveFilteredList(ctx([]), { list: 'inventory', query: 'q=a' })).toBeNull();
    expect(await resolveFilteredList(ctx([]), { list: 'pipeline', query: 'q=a' })).toBeNull();
  });

  it('says nothing rather than guess when the read fails', async () => {
    expect(await resolveFilteredList(ctx(['shopping']), { list: 'inventory', query: 'q=a' })).toBeNull();
  });
});

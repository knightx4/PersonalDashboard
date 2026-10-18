import { describe, expect, it } from 'vitest';
import type { CollectionRecord } from './collections-store';
import {
  chipLine,
  chipOf,
  goalListViews,
  listForTab,
  listTabId,
  pickPlan,
  slugOf,
  tabsWithLists,
} from './goal-lists';
import type { LinkedList, LinkedReading, LinkedSavedItem } from './links';
import type { GoalList } from './lists-store';

/** A goal's lists as chips, a panel and tabs (plan #2330.3). */

function record(id: string, data: CollectionRecord['data'], extra: Partial<CollectionRecord> = {}): CollectionRecord {
  return {
    id,
    collectionId: 'pantries',
    data,
    version: 1,
    position: 0,
    source: 'typed',
    sourceRef: null,
    draft: false,
    asOf: null,
    updatedAt: '2026-10-17T00:00:00Z',
    ...extra,
  };
}

const pantries: GoalList = {
  id: 'pantries',
  goalId: 'goal',
  name: 'Pantry options',
  position: 0,
  version: 1,
  fields: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'picture', label: 'Picture', type: 'image' },
    { key: 'width', label: 'Wide', type: 'number' },
    { key: 'price', label: 'Price', type: 'money' },
    { key: 'status', label: 'Status', type: 'choice', options: ['Considering', 'Picked', 'Ruled out'] },
    { key: 'link', label: 'Link', type: 'link' },
  ],
  rows: [
    record('homcom', { name: 'HOMCOM 72 inch pantry', picture: 'https://cdn.example.com/h.jpg', width: 30, price: 189.99, status: 'Picked', link: 'https://shop.example.com/h' }),
    record('ikea', { name: 'IKEA cabinet', status: 'Considering' }),
    record('tall', { name: 'Tall narrow one', status: 'Ruled out' }),
  ],
};

function reading(id: string, status: string, extra: Partial<LinkedReading> = {}): LinkedReading {
  return {
    kind: 'reading',
    linkId: `link-${id}`,
    targetId: id,
    listName: 'Reading',
    gone: false,
    href: `/learn/r/${id}`,
    title: `Reading ${id}`,
    status,
    startedAt: null,
    finishedAt: null,
    ...extra,
  };
}

const readingList: LinkedList = {
  name: 'Reading',
  kinds: ['reading'],
  rows: [reading('a', 'read'), reading('b', 'queued'), reading('c', 'abandoned'), reading('d', 'queued', { gone: true, title: null, href: null })],
};

describe('a goal list as the page draws it', () => {
  const [own, linked] = goalListViews([pantries], [readingList]);

  it('names an own row by its name field and leaves the picture, link and name out of the columns', () => {
    expect(own.rows.map((r) => r.title)).toEqual(['HOMCOM 72 inch pantry', 'IKEA cabinet']);
    expect(own.columns.map((c) => c.label)).toEqual(['Wide', 'Price', 'Status']);
    expect(own.rows[0]).toMatchObject({ picture: 'https://cdn.example.com/h.jpg', href: 'https://shop.example.com/h', external: true, picked: true });
    expect(own.columns.find((c) => c.key === 'price')?.num).toBe(true);
  });

  it('folds a row marked ruled out away from the rows in play', () => {
    expect(own.ruledOut.map((r) => r.title)).toEqual(['Tall narrow one']);
  });

  it('says the picked row on the chip after the count of rows in play', () => {
    expect(own.standout).toBe('HOMCOM 72 picked');
    expect(chipLine(chipOf(own))).toBe('2 · HOMCOM 72 picked');
    expect(chipLine({ count: 0, standout: null })).toBe('');
    expect(chipOf(own).pictures).toEqual(['https://cdn.example.com/h.jpg']);
  });

  it('puts drafts to confirm ahead of anything picked', () => {
    const [view] = goalListViews([{ ...pantries, rows: [...pantries.rows, record('new', { name: 'From a link' }, { draft: true })] }], []);
    expect(view.standout).toBe('1 to confirm');
  });

  it('reads a linked reading in Learn’s words, opens it in Learn, and folds an abandoned one away', () => {
    expect(linked.rows.map((r) => [r.title, r.cells.status, r.href])).toEqual([
      ['Reading a', 'Read', '/learn/r/a'],
      ['Reading b', 'Not started', '/learn/r/b'],
      ['A reading', undefined, null],
    ]);
    expect(linked.ruledOut.map((r) => r.title)).toEqual(['Reading c']);
    expect(linked.standout).toBe('1 read');
  });

  it('shows a bought product as the standout of a product list', () => {
    const bought: LinkedSavedItem = {
      kind: 'saved_item',
      linkId: 'l1',
      targetId: 's1',
      listName: 'Products',
      gone: false,
      href: '/shopping/saved/s1',
      title: 'Shelf liner',
      url: null,
      imageUrl: null,
      priceCents: 1299,
      currency: 'USD',
      status: 'purchased',
      bought: true,
    };
    const [view] = goalListViews([], [{ name: 'Products', kinds: ['saved_item'], rows: [bought] }]);
    expect(view.standout).toBe('Shelf liner bought');
    expect(view.rows[0].cells).toEqual({ price: '$12.99', status: 'Bought' });
  });

  it('gives two lists of one name different keys', () => {
    const views = goalListViews([{ ...pantries, name: 'Reading' }], [readingList]);
    expect(views.map((v) => v.key)).toEqual(['reading', 'reading-2']);
  });
});

describe('list tabs', () => {
  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'steps', label: 'Steps', count: 4 },
    { id: 'activity', label: 'Activity' },
  ];

  it('leaves the tabs alone below three lists', () => {
    const views = goalListViews([pantries], [readingList]);
    expect(tabsWithLists(tabs, views)).toEqual(tabs);
    expect(listForTab(listTabId(views[0].key), views)).toBeNull();
  });

  it('puts a tab for each of three lists after Steps, counting the rows in play', () => {
    const views = goalListViews([pantries, { ...pantries, id: 'groups', name: 'Groups to try', rows: [] }], [readingList]);
    expect(tabsWithLists(tabs, views).map((t) => t.id)).toEqual([
      'overview',
      'steps',
      'list-pantry-options',
      'list-groups-to-try',
      'list-reading',
      'activity',
    ]);
    expect(tabsWithLists(tabs, views)[2]).toMatchObject({ label: 'Pantry options', count: 2 });
    expect(listForTab('list-reading', views)?.name).toBe('Reading');
  });

  it('makes an address-safe key of any name', () => {
    expect(slugOf('Groups to try!')).toBe('groups-to-try');
    expect(slugOf('Café & bars')).toBe('cafe-bars');
    expect(slugOf('—')).toBe('list');
  });
});

describe('picking a row rules out the rest (plan #2330.5)', () => {
  const rows = [
    { id: 'a', data: { name: 'HOMCOM', status: 'Shortlist' } },
    { id: 'b', data: { name: 'IKEA', status: null } },
    { id: 'c', data: { name: 'Wayfair', status: 'Ruled out' } },
  ];

  it("uses the list's own picked and ruled-out options", () => {
    const fields = [
      { key: 'name', label: 'Name', type: 'text' as const },
      { key: 'status', label: 'Status', type: 'choice' as const, options: ['Shortlist', 'Picked', 'Ruled out'] },
    ];
    expect(pickPlan(fields, rows, 'a')).toEqual({
      fields,
      fieldsChanged: false,
      statusKey: 'status',
      picked: 'Picked',
      ruledOut: 'Ruled out',
      others: ['b'],
    });
  });

  it('adds the options a status field lacks', () => {
    const fields = [{ key: 'decision', label: 'Decision', type: 'choice' as const, options: ['Maybe', 'Chosen'] }];
    const plan = pickPlan(fields, rows, 'b');
    expect(plan.picked).toBe('Chosen');
    expect(plan.ruledOut).toBe('Ruled out');
    expect(plan.fieldsChanged).toBe(true);
    expect(plan.fields[0].options).toEqual(['Maybe', 'Chosen', 'Ruled out']);
    expect(plan.others).toEqual(['a', 'c']);
  });

  it('gives a list with no status field one', () => {
    const fields = [
      { key: 'name', label: 'Name', type: 'text' as const },
      { key: 'status', label: 'Where it is', type: 'text' as const },
    ];
    const plan = pickPlan(fields, rows, 'a');
    expect(plan.fields[2]).toEqual({ key: 'status_2', label: 'Status', type: 'choice', options: ['Picked', 'Ruled out'] });
    expect(plan.statusKey).toBe('status_2');
    expect(plan.others).toEqual(['b', 'c']);
  });
});

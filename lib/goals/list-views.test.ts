import { describe, expect, it } from 'vitest';
import type { CollectionRecord } from './collections-store';
import { goalListViews, type ListView } from './goal-lists';
import type { LinkedEvent, LinkedList, LinkedSavedItem } from './links';
import type { GoalList } from './lists-store';
import {
  comingUp,
  defaultView,
  listMonth,
  mapPins,
  monthToOpen,
  pickView,
  shiftMonth,
  viewsFor,
} from './list-views';

/** Which views a goal's list offers and opens on, the month and the pins (plan #2330.4). */

function record(id: string, data: CollectionRecord['data']): CollectionRecord {
  return {
    id,
    collectionId: 'l',
    data,
    version: 1,
    position: 0,
    source: 'typed',
    sourceRef: null,
    draft: false,
    asOf: null,
    updatedAt: '2026-10-17T00:00:00Z',
  };
}

function own(fields: GoalList['fields'], rows: CollectionRecord[], name = 'List'): GoalList {
  return { id: `l-${name}`, goalId: 'g', name, position: 0, version: 1, fields, rows };
}

const TODAY = '2026-10-17';

function viewOf(list: GoalList): ListView {
  return goalListViews([list], [], { today: TODAY, timeZone: 'UTC' })[0];
}

const pantries = own(
  [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'picture', label: 'Picture', type: 'image' },
    { key: 'price', label: 'Price', type: 'money' },
  ],
  [record('a', { name: 'HOMCOM', picture: 'https://cdn.example.com/a.jpg', price: 189 }), record('b', { name: 'Oak' })],
);

const shops = own(
  [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'where', label: 'Where', type: 'place' },
    { key: 'visit', label: 'Visit on', type: 'date' },
  ],
  [
    record('s1', { name: 'Habitat', where: { address: '196 Tottenham Court Rd', lat: 51.52, lng: -0.134 }, visit: '2026-10-24' }),
    record('s2', { name: 'Market stall', where: { address: 'Camden Lock' } }),
    record('s3', { name: 'Somewhere', visit: '2026-09-02' }),
  ],
  'Shops',
);

function event(id: string, extra: Partial<LinkedEvent>): LinkedEvent {
  return {
    kind: 'event',
    linkId: `link-${id}`,
    targetId: id,
    listName: 'Events',
    gone: false,
    href: `/todo/calendar?event=${id}`,
    title: id,
    location: null,
    startsOn: null,
    endsOn: null,
    startsAt: null,
    endsAt: null,
    ...extra,
  };
}

describe('the views a list offers', () => {
  it('opens a list with pictures on Compare, and offers Gallery and Table beside it', () => {
    const view = viewOf(pantries);
    expect(viewsFor(view)).toEqual(['compare', 'gallery', 'table']);
    expect(defaultView(view)).toBe('compare');
  });

  it('offers Calendar for dates and Map for places, and opens on the calendar when nothing has a picture', () => {
    const view = viewOf(shops);
    expect(viewsFor(view)).toEqual(['calendar', 'map', 'table']);
    expect(defaultView(view)).toBe('calendar');
  });

  it('offers a view its fields allow before any row fills it, but opens on the table', () => {
    const empty = viewOf(own(shops.fields, [record('x', { name: 'Nowhere yet' })], 'Shops'));
    expect(viewsFor(empty)).toEqual(['calendar', 'map', 'table']);
    expect(defaultView(empty)).toBe('table');
  });

  it('offers only the table to a list of names and notes', () => {
    const plain = viewOf(own([{ key: 'name', label: 'Name', type: 'text' }], [record('x', { name: 'A' })]));
    expect(viewsFor(plain)).toEqual(['table']);
  });

  it('keeps the view last chosen while the list still offers it', () => {
    const view = viewOf(shops);
    expect(pickView(view, 'map')).toBe('map');
    expect(pickView(view, 'gallery')).toBe('calendar');
    expect(pickView(view, 'nonsense')).toBe('calendar');
    expect(pickView(view, null)).toBe('calendar');
  });

  it('gives linked events the calendar and the map, and saved products Compare', () => {
    const events: LinkedList = {
      name: 'Fairs',
      kinds: ['event'],
      rows: [event('fair', { startsOn: '2026-10-24', location: 'Olympia, London' })],
    };
    const saved: LinkedSavedItem = {
      kind: 'saved_item',
      linkId: 'link-s',
      targetId: 's',
      listName: 'Products',
      gone: false,
      href: '/shopping/saved',
      title: 'Lamp',
      url: null,
      imageUrl: 'https://cdn.example.com/l.jpg',
      priceCents: 2000,
      currency: 'GBP',
      status: 'saved',
      bought: false,
    };
    const [fairs, products] = goalListViews([], [events, { name: 'Products', kinds: ['saved_item'], rows: [saved] }], {
      today: TODAY,
      timeZone: 'UTC',
    });
    expect(viewsFor(fairs)).toEqual(['calendar', 'map', 'table']);
    expect(fairs.rows[0].day).toBe('2026-10-24');
    expect(fairs.rows[0].place).toEqual({ address: 'Olympia, London' });
    expect(defaultView(products)).toBe('compare');
  });

  it('reads a timed event on the day it is in the person zone', () => {
    const [list] = goalListViews(
      [],
      [{ name: 'Late', kinds: ['event'], rows: [event('late', { startsAt: '2026-10-24T23:30:00Z' })] }],
      { today: TODAY, timeZone: 'Europe/Berlin' },
    );
    expect(list.rows[0].day).toBe('2026-10-25');
  });
});

describe('the calendar', () => {
  const rows = viewOf(shops).rows;

  it('opens on this month while anything is still to come', () => {
    expect(monthToOpen(rows, TODAY)).toBe('2026-10');
  });

  it('opens on the latest month when everything is past', () => {
    expect(monthToOpen(rows, '2027-03-01')).toBe('2026-10');
    expect(monthToOpen(rows.filter((r) => r.id === 's3'), TODAY)).toBe('2026-09');
  });

  it('lays a month out in Monday-first weeks with the rows on their days', () => {
    const month = listMonth(rows, '2026-10', TODAY);
    expect(month.label).toBe('October 2026');
    // 1 October 2026 is a Thursday, so the first week starts on Monday 28 September.
    expect(month.weeks[0][0].day).toBe('2026-09-28');
    expect(month.weeks[0][3]).toMatchObject({ day: '2026-10-01', inMonth: true });
    expect(month.weeks.at(-1)?.at(-1)?.day).toBe('2026-11-01');
    const visit = month.weeks.flat().find((d) => d.day === '2026-10-24');
    expect(visit?.rows.map((r) => r.id)).toEqual(['s1']);
    expect(month.weeks.flat().find((d) => d.isToday)?.day).toBe(TODAY);
    expect(month.count).toBe(1);
    expect(listMonth(rows, '2026-11', TODAY).count).toBe(0);
  });

  it('steps months across a year', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });

  it('lists what is coming from today, soonest first', () => {
    expect(comingUp(rows, TODAY).map((r) => r.id)).toEqual(['s1']);
  });
});

describe('the map', () => {
  it('pins the rows with a point and lists the ones with an address alone', () => {
    const { pins, unpinned } = mapPins(viewOf(shops).rows);
    expect(pins).toEqual([expect.objectContaining({ n: 1, lat: 51.52, lng: -0.134, address: '196 Tottenham Court Rd' })]);
    expect(unpinned.map((r) => r.id)).toEqual(['s2']);
  });
});

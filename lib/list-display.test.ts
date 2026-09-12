import { describe, expect, it } from 'vitest';
import {
  displayHref,
  groupRows,
  hideableProperties,
  isHidden,
  NO_GROUP,
  parseListDisplay,
  sortRows,
  toggleHidden,
  visibleProperties,
  type ListDisplaySpec,
  type ListSearchParams,
} from './list-display';

type Order = {
  id: string;
  merchant: string | null;
  status: string;
  total_cents: number;
  ordered_on: string;
};

const orders: Order[] = [
  { id: 'a', merchant: 'Amazon', status: 'delivered', total_cents: 1200, ordered_on: '2026-03-04' },
  { id: 'b', merchant: 'Target', status: 'shipped', total_cents: 500, ordered_on: '2026-04-11' },
  { id: 'c', merchant: null, status: 'delivered', total_cents: 2500, ordered_on: '2026-03-27' },
];

const spec: ListDisplaySpec<Order> = {
  pathname: '/shopping/orders',
  sorts: [
    { id: 'newest', label: 'Newest', compare: (a, b) => b.ordered_on.localeCompare(a.ordered_on) },
    { id: 'oldest', label: 'Oldest', compare: (a, b) => a.ordered_on.localeCompare(b.ordered_on) },
    { id: 'total_desc', label: 'Total: high to low', compare: (a, b) => b.total_cents - a.total_cents },
  ],
  groups: [
    {
      id: 'month',
      label: 'Month',
      order: 'key-desc',
      bucket: (order) => ({ key: order.ordered_on.slice(0, 7), label: order.ordered_on.slice(0, 7) }),
    },
    {
      id: 'merchant',
      label: 'Merchant',
      emptyLabel: 'No merchant',
      bucket: (order) => (order.merchant ? { key: order.merchant, label: order.merchant } : null),
    },
    {
      id: 'status',
      label: 'Status',
      bucket: (order) => ({
        key: order.status,
        label: order.status,
        rank: order.status === 'shipped' ? 1 : 2,
      }),
    },
  ],
  properties: [
    { id: 'merchant', label: 'Merchant', alwaysOn: true },
    { id: 'number', label: 'Order number' },
    { id: 'person', label: 'Whose order' },
    { id: 'summary', label: 'What was in it' },
  ],
  defaultGroup: 'month',
};

/** The params a Next page would receive for a link this module built. */
function paramsFrom(href: string): ListSearchParams {
  const query = new URLSearchParams(href.split('?')[1] ?? '');
  const params: ListSearchParams = {};
  for (const key of new Set(query.keys())) {
    const values = query.getAll(key);
    params[key] = values.length > 1 ? values : values[0];
  }
  return params;
}

const totalCents = (rows: Order[]) => rows.reduce((sum, order) => sum + order.total_cents, 0);

describe('parseListDisplay', () => {
  it('falls back to the declared defaults on an empty URL', () => {
    const state = parseListDisplay(spec, {});
    expect(state.sort).toBe('newest');
    expect(state.group).toBe('month');
    expect(state.hidden).toEqual([]);
    expect(state.sortBy?.id).toBe('newest');
    expect(state.groupBy?.id).toBe('month');
  });

  it('defaults to no grouping when the page declares none', () => {
    const state = parseListDisplay({ ...spec, defaultGroup: undefined }, {});
    expect(state.group).toBe(NO_GROUP);
    expect(state.groupBy).toBeNull();
  });

  it('reads the chosen sort and grouping', () => {
    const state = parseListDisplay(spec, { sort: 'oldest', group: 'merchant' });
    expect(state.sort).toBe('oldest');
    expect(state.groupBy?.id).toBe('merchant');
  });

  it('keeps the default rather than emptying the list on an unknown sort or grouping', () => {
    const state = parseListDisplay(spec, { sort: 'sideways', group: 'colour' });
    expect(state.sort).toBe('newest');
    expect(state.group).toBe('month');
    expect(sortRows(orders, state)).toHaveLength(3);
    expect(groupRows(orders, state.groupBy)).toHaveLength(2);
  });

  it('reads no grouping asked for by name', () => {
    const state = parseListDisplay(spec, { group: NO_GROUP });
    expect(state.group).toBe(NO_GROUP);
    expect(state.groupBy).toBeNull();
  });

  it('drops a property the page does not let go of, and one it does not know', () => {
    const state = parseListDisplay(spec, { hide: 'merchant,number,invented' });
    expect(state.hidden).toEqual(['number']);
    expect(isHidden(state, 'number')).toBe(true);
    expect(isHidden(state, 'merchant')).toBe(false);
    expect(hideableProperties(spec).map((p) => p.id)).toEqual(['number', 'person', 'summary']);
    expect(visibleProperties(spec, state).map((p) => p.id)).toEqual([
      'merchant',
      'person',
      'summary',
    ]);
  });

  it('reads hidden properties from a repeated parameter as well as a comma list', () => {
    expect(parseListDisplay(spec, { hide: ['summary', 'number'] }).hidden).toEqual([
      'number',
      'summary',
    ]);
  });
});

describe('sortRows', () => {
  it('sorts by the chosen comparator without touching the rows it was given', () => {
    const state = parseListDisplay(spec, { sort: 'total_desc' });
    expect(sortRows(orders, state).map((order) => order.id)).toEqual(['c', 'a', 'b']);
    expect(orders.map((order) => order.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('groupRows', () => {
  it('returns one bucket when there is no grouping', () => {
    const groups = groupRows(orders, null, totalCents);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(3);
    expect(groups[0]?.subtotal).toBe(4200);
  });

  it('puts the rows with no value in a bucket at the end', () => {
    const state = parseListDisplay(spec, { group: 'merchant' });
    const groups = groupRows(orders, state.groupBy);
    expect(groups.map((group) => group.label)).toEqual(['Amazon', 'Target', 'No merchant']);
    expect(groups.at(-1)?.rows.map((order) => order.id)).toEqual(['c']);
  });

  it('orders buckets by key when the grouping asks for it', () => {
    const state = parseListDisplay(spec, { group: 'month' });
    expect(groupRows(orders, state.groupBy).map((group) => group.key)).toEqual([
      '2026-04',
      '2026-03',
    ]);
  });

  it('puts a ranked bucket before an unranked one and keeps ranks in order', () => {
    const state = parseListDisplay(spec, { group: 'status' });
    expect(groupRows(orders, state.groupBy).map((group) => group.key)).toEqual([
      'shipped',
      'delivered',
    ]);
  });

  it('subtotals each bucket and the buckets add up to the whole list', () => {
    const state = parseListDisplay(spec, { group: 'month' });
    const groups = groupRows(orders, state.groupBy, totalCents);
    expect(groups.map((group) => [group.key, group.count, group.subtotal])).toEqual([
      ['2026-04', 1, 500],
      ['2026-03', 2, 3700],
    ]);
    expect(groups.reduce((sum, group) => sum + (group.subtotal ?? 0), 0)).toBe(totalCents(orders));
  });
});

describe('displayHref', () => {
  it('keeps every other parameter the page carries', () => {
    const params: ListSearchParams = { q: 'lamp', range: 'last_3_months', attr: ['a:1', 'b:2'] };
    const href = displayHref(spec, params, { sort: 'oldest' });
    const next = paramsFrom(href);
    expect(href.startsWith('/shopping/orders?')).toBe(true);
    expect(next.q).toBe('lamp');
    expect(next.range).toBe('last_3_months');
    expect(next.attr).toEqual(['a:1', 'b:2']);
    expect(next.sort).toBe('oldest');
  });

  it('leaves the defaults out of the link', () => {
    expect(displayHref(spec, { sort: 'oldest' }, { sort: 'newest' })).toBe('/shopping/orders');
    expect(displayHref(spec, {}, { group: 'month' })).toBe('/shopping/orders');
    expect(displayHref(spec, {}, { group: NO_GROUP })).toBe('/shopping/orders?group=none');
  });

  it('carries a hidden property through the URL and back', () => {
    const href = displayHref(spec, { q: 'lamp' }, { hidden: ['summary', 'number'] });
    const state = parseListDisplay(spec, paramsFrom(href));
    expect(state.hidden).toEqual(['number', 'summary']);
    expect(paramsFrom(href).q).toBe('lamp');
  });

  it('turns one property off and back on from the URL as it stands', () => {
    const off = displayHref(spec, { group: 'merchant' }, { toggleProperty: 'person' });
    expect(parseListDisplay(spec, paramsFrom(off)).hidden).toEqual(['person']);
    const on = displayHref(spec, paramsFrom(off), { toggleProperty: 'person' });
    expect(parseListDisplay(spec, paramsFrom(on)).hidden).toEqual([]);
    expect(parseListDisplay(spec, paramsFrom(on)).group).toBe('merchant');
  });

  it('ignores a change the page does not offer', () => {
    expect(displayHref(spec, { sort: 'oldest' }, { sort: 'sideways' })).toBe('/shopping/orders');
  });

  it('uses the parameter names a page overrides', () => {
    const renamed: ListDisplaySpec<Order> = {
      ...spec,
      params: { sort: 'by', group: 'bucket', hidden: 'off' },
    };
    const href = displayHref(renamed, { sort: 'oldest' }, { sort: 'oldest', hidden: ['person'] });
    expect(href).toBe('/shopping/orders?sort=oldest&by=oldest&off=person');
    expect(parseListDisplay(renamed, paramsFrom(href)).sort).toBe('oldest');
  });
});

describe('toggleHidden', () => {
  it('adds and removes', () => {
    expect(toggleHidden([], 'person')).toEqual(['person']);
    expect(toggleHidden(['person', 'number'], 'person')).toEqual(['number']);
  });
});

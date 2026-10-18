import { describe, expect, it } from 'vitest';
import {
  addressHref,
  choiceColumn,
  columnFilters,
  commonValues,
  pageOf,
  parsePage,
  parseView,
  withoutPage,
  type PageAddress,
} from './table-view';

type Params = { view?: string; kind?: string; owner?: string; page?: string; hide?: string | string[] };

const address: PageAddress<Params> = { path: '/things', defaults: { view: 'focus' } };
const href = (params: Params, changes: Partial<Record<keyof Params, string | undefined>>) =>
  addressHref(address, params, changes);

describe('addressHref', () => {
  it('keeps the other params, drops the page and leaves defaults out', () => {
    expect(href({ view: 'table', kind: 'book', page: '3' }, { owner: 'me' })).toBe(
      '/things?view=table&kind=book&owner=me',
    );
    expect(href({ view: 'table', kind: 'book' }, { view: 'focus', kind: undefined })).toBe('/things');
    expect(href({ view: 'table' }, { page: '2' })).toBe('/things?view=table&page=2');
    expect(href({ view: 'table', page: '4' }, { page: '1' })).toBe('/things?view=table');
  });

  it('joins a list param with commas', () => {
    expect(href({ hide: ['a', 'b'] }, {})).toBe('/things?hide=a%2Cb');
    expect(href({ hide: [] }, {})).toBe('/things');
  });
});

describe('parseView and parsePage', () => {
  it('reads only a view the page has, and a page above one', () => {
    expect(parseView('table', ['focus', 'table'] as const, 'focus')).toBe('table');
    expect(parseView('board', ['focus', 'table'] as const, 'focus')).toBe('focus');
    expect(parseView(undefined, ['focus', 'table'] as const, 'focus')).toBe('focus');
    expect(parsePage('3')).toBe(3);
    expect(parsePage('-3')).toBe(1);
    expect(parsePage('2.5')).toBe(1);
    expect(parsePage(undefined)).toBe(1);
  });
});

describe('pageOf', () => {
  it('pages and clamps', () => {
    const items = Array.from({ length: 120 }, (_, i) => i);
    expect(pageOf(items, 2)).toMatchObject({ page: 2, pages: 3, first: 51, last: 100 });
    expect(pageOf(items, 9)).toMatchObject({ page: 3, first: 101, last: 120 });
    expect(pageOf([], 1)).toMatchObject({ page: 1, pages: 1, first: 0, last: 0 });
    expect(pageOf(items, 2, 10)).toMatchObject({ pages: 12, first: 11, last: 20 });
  });

  it('takes the page out for the links that rearrange the table', () => {
    expect(withoutPage({ view: 'table', page: '2' })).toEqual({ view: 'table' });
  });
});

describe('columnFilters', () => {
  const params: Params = { view: 'table', kind: 'book' };
  const tableHref = (changes: Partial<Record<keyof Params, string | undefined>>) =>
    href(params, { view: 'table', ...changes });

  it('builds a menu for each column given, with links that keep the rest of the address', () => {
    const filters = columnFilters<Params>(
      [
        choiceColumn({
          id: 'kind',
          param: 'kind',
          current: 'book',
          anyLabel: 'Any kind',
          choices: [
            { value: 'book', label: 'Books' },
            { value: 'film', label: 'Films' },
          ],
        }),
        false,
        null,
      ],
      tableHref,
    );
    expect(Object.keys(filters)).toEqual(['kind']);
    expect(filters.kind.active).toBe(true);
    expect(filters.kind.choices).toEqual([
      { id: 'any', label: 'Any kind', href: '/things?view=table', current: false },
      { id: 'kind-book', label: 'Books', href: '/things?view=table&kind=book', current: true },
      { id: 'kind-film', label: 'Films', href: '/things?view=table&kind=film', current: false },
    ]);
  });

  it('takes a column whose choices change more than one param', () => {
    const { owner } = columnFilters<Params>(
      [
        {
          id: 'owner',
          active: false,
          options: [{ id: 'mine', label: 'Mine', changes: { owner: 'me', kind: undefined }, current: false }],
        },
      ],
      tableHref,
    );
    expect(owner.choices[0].href).toBe('/things?view=table&owner=me');
  });

  it('names the choice ids from a prefix when given one', () => {
    const column = choiceColumn<Params>({
      id: 'applied',
      param: 'kind',
      prefix: 'sent',
      current: null,
      anyLabel: 'Any time',
      choices: [{ value: '7', label: 'Last 7 days' }],
    });
    expect(column.active).toBe(false);
    expect(column.options.map((o) => [o.id, o.current])).toEqual([
      ['any', true],
      ['sent-7', false],
    ]);
  });
});

describe('commonValues', () => {
  const rows = ['b', 'a', 'b', 'c', 'c', 'c', 'd'].map((k) => ({ k, name: k.toUpperCase() }));
  const common = (limit: number, chosen: string | null) =>
    commonValues(rows, (r) => r.k, (r) => r.name, limit, chosen).map((v) => `${v.name}${v.count}`);

  it('lists the most frequent first, then by name, up to the limit', () => {
    expect(common(3, null)).toEqual(['C3', 'B2', 'A1']);
  });

  it('always lists the chosen value, past the limit', () => {
    expect(common(2, 'd')).toEqual(['C3', 'B2', 'D1']);
    expect(common(2, 'zzz')).toEqual(['C3', 'B2']);
  });
});

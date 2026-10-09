import { describe, expect, it } from 'vitest';
import { askListFilter, askListLabel, parseAskListFilter } from './list-filter';
import { parseAskInput } from '@/lib/talk/ask-input';

describe('the filter a list is under (plan #1658)', () => {
  it('is none while the list is unfiltered, so the button is hidden', () => {
    expect(askListFilter('inventory', {})).toBeNull();
    // Sorting, grouping and hidden columns do not narrow it.
    expect(askListFilter('inventory', { sort: 'cost', group: 'category', hide: 'cost', range: 'all' })).toBeNull();
    expect(askListFilter('inventory', { q: '   ', category: '' })).toBeNull();
    expect(askListFilter('pipeline', {})).toBeNull();
    expect(askListFilter('pipeline', { view: 'board', page: '3', sort: 'company' })).toBeNull();
    // Every application is the whole list, not a filter of it.
    expect(askListFilter('pipeline', { status: 'all' })).toBeNull();
    expect(askListFilter('pipeline', { status: 'live' })).toBeNull();
  });

  it('keeps only the params that narrow the inventory', () => {
    const filter = askListFilter('inventory', {
      category: 'c1',
      range: 'this_month',
      sort: 'cost',
      attr: ['brand:Hasbro', 'players:4'],
    });
    expect(filter).toEqual({
      list: 'inventory',
      query: 'category=c1&range=this_month&attr=brand%3AHasbro&attr=players%3A4',
    });
  });

  it('treats a closed, sourced or searched pipeline as filtered, and keeps the scope beside another filter', () => {
    expect(askListFilter('pipeline', { status: 'closed' })).toEqual({ list: 'pipeline', query: 'status=closed' });
    expect(askListFilter('pipeline', { source: 'linkedin', view: 'table' })).toEqual({
      list: 'pipeline',
      query: 'source=linkedin',
    });
    expect(askListFilter('pipeline', { status: 'all', q: 'acme' })?.query).toBe('status=all&q=acme');
  });

  it('is the same filter once it has been through the browser and back', () => {
    const filter = askListFilter('inventory', { q: 'catan', person: 'p1' })!;
    expect(parseAskListFilter(JSON.parse(JSON.stringify(filter)))).toEqual(filter);
  });

  it('refuses anything that is not a known list with a narrowing query', () => {
    expect(parseAskListFilter(null)).toBeNull();
    expect(parseAskListFilter({ list: 'vault', query: 'q=a' })).toBeNull();
    expect(parseAskListFilter({ list: 'toString', query: 'q=a' })).toBeNull();
    expect(parseAskListFilter({ list: 'inventory', query: 5 })).toBeNull();
    expect(parseAskListFilter({ list: 'inventory', query: 'sort=cost' })).toBeNull();
    expect(parseAskListFilter({ list: 'inventory', query: 'q='.padEnd(2000, 'a') })).toBeNull();
  });

  it('drops params the list does not read', () => {
    expect(parseAskListFilter({ list: 'pipeline', query: 'source=referral&user_id=x&hide=a' })).toEqual({
      list: 'pipeline',
      query: 'source=referral',
    });
  });

  it('reaches the question as the route reads it', () => {
    const checked = parseAskInput('Mark these for sale', null, '/shopping/inventory', {
      list: 'inventory',
      query: 'category=c1',
    });
    expect(checked).toMatchObject({ ok: true, input: { list: { list: 'inventory', query: 'category=c1' } } });
    expect(parseAskInput('Hi', null, null)).toMatchObject({ ok: true, input: { list: null } });
  });

  it('labels the rows with the count and the list', () => {
    expect(askListLabel('inventory', 12)).toBe('12 items from Inventory');
    expect(askListLabel('pipeline', 1)).toBe('1 role from Pipeline');
  });
});

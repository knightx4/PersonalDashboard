import { describe, expect, it } from 'vitest';
import { otherParams, searchHref, SEARCH_PARAM } from './list-search';

describe('searchHref', () => {
  it('adds a search and keeps every other parameter', () => {
    const params = new URLSearchParams('status=open&sort=newest&tag=blue&tag=red');
    expect(searchHref('/shopping/orders', params, 'amazon')).toBe(
      '/shopping/orders?status=open&sort=newest&tag=blue&tag=red&q=amazon',
    );
  });

  it('changes a search where it already sits', () => {
    const params = new URLSearchParams('status=open&q=amazon&sort=newest');
    expect(searchHref('/shopping/orders', params, 'target')).toBe(
      '/shopping/orders?status=open&q=target&sort=newest',
    );
  });

  it('clears a search and leaves the filters behind', () => {
    const params = new URLSearchParams('status=open&q=amazon&sort=newest');
    expect(searchHref('/shopping/orders', params, '')).toBe(
      '/shopping/orders?status=open&sort=newest',
    );
  });

  it('returns the bare path when the search was all the URL carried', () => {
    expect(searchHref('/vault', new URLSearchParams('q=recipes'), '  ')).toBe('/vault');
  });

  it('trims what was typed', () => {
    expect(searchHref('/vault', new URLSearchParams(), '  recipes ')).toBe('/vault?q=recipes');
  });

  it('reads the parameters a page receives as well as the browser copy', () => {
    const params = { status: 'open', tag: ['blue', 'red'], group: undefined, empty: '' };
    expect(searchHref('/todo/all', params, 'invoice')).toBe(
      '/todo/all?status=open&tag=blue&tag=red&q=invoice',
    );
  });

  it('searches under another name when a page already uses q for something else', () => {
    const params = new URLSearchParams('q=note&find=old');
    expect(searchHref('/dev/changelog', params, 'new', 'find')).toBe(
      '/dev/changelog?q=note&find=new',
    );
  });

  it('keeps one search when the URL somehow carries two', () => {
    const params = new URLSearchParams('q=one&status=open&q=two');
    expect(searchHref('/vault', params, 'three')).toBe('/vault?q=three&status=open');
  });
});

describe('otherParams', () => {
  it('lists what a form has to carry through a search, and not the search', () => {
    const params = new URLSearchParams('status=open&q=amazon&tag=blue&tag=red&sort=');
    expect(otherParams(params)).toEqual([
      ['status', 'open'],
      ['tag', 'blue'],
      ['tag', 'red'],
    ]);
  });

  it('names the search parameter the app agreed on', () => {
    expect(SEARCH_PARAM).toBe('q');
  });
});

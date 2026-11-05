import { describe, expect, it } from 'vitest';
import { ideasHref, mapAddress, shapeIdeas } from './ideas';

describe('mapAddress (plan #2947.5)', () => {
  it('reads the view, sort and page, defaulting anything unknown', () => {
    expect(mapAddress({})).toEqual({ view: 'themes', sort: 'combined', page: 1 });
    expect(mapAddress({ view: 'ideas', sort: 'novelty', page: '3' })).toEqual({
      view: 'ideas',
      sort: 'novelty',
      page: 3,
    });
    expect(mapAddress({ view: 'other', sort: 'loudness', page: '-2' })).toEqual({
      view: 'themes',
      sort: 'combined',
      page: 1,
    });
    expect(mapAddress({ view: ['ideas', 'themes'], sort: ['usefulness'] }).sort).toBe('usefulness');
  });
});

describe('ideasHref', () => {
  it('leaves the defaults out of the address', () => {
    expect(ideasHref('combined')).toBe('/vault/map?view=ideas');
    expect(ideasHref('usefulness', 2)).toBe('/vault/map?view=ideas&sort=usefulness&page=2');
  });
});

describe('shapeIdeas', () => {
  it('keeps a theme and a source only when they are whole', () => {
    const [row] = shapeIdeas([
      {
        position_id: 'p1',
        statement: 'S',
        usefulness: 81,
        novelty: 36,
        combined: 54,
        theme_id: null,
        theme_name: null,
        quote: 'Q',
        note_path: 'A.md',
        note_title: 'A',
        total: '1',
      },
    ]);
    expect(row.theme).toBeNull();
    expect(row.source).toEqual({ quote: 'Q', path: 'A.md', title: 'A' });
  });
});

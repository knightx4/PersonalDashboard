import { describe, expect, it } from 'vitest';
import {
  checkPlace,
  draftOf,
  formatRoughDate,
  livedInYear,
  placeSpan,
  readRoughDate,
  sortPlaces,
  timeThere,
  type Place,
} from './places';

/** The places they have lived (plan #1991.5): rough dates, the order, and which year they cover. */

const place = (fields: Partial<Place>): Place => ({
  id: fields.name ?? 'x',
  name: 'Somewhere',
  city: null,
  region: null,
  country: null,
  movedIn: '2000',
  movedOut: null,
  note: null,
  ...fields,
});

describe('rough dates', () => {
  it.each([
    ['2019', '2019'],
    [' 2019 ', '2019'],
    ['2019-3', '2019-03'],
    ['2019-03', '2019-03'],
    ['2019/11', '2019-11'],
    ['3/2019', '2019-03'],
    ['March 2019', '2019-03'],
    ['mar 2019', '2019-03'],
    ['Sept. 2019', '2019-09'],
  ])('reads %j as %j', (typed, stored) => {
    expect(readRoughDate(typed)).toBe(stored);
  });

  it.each(['', 'soon', '19', '2019-13', '13/2019', 'Ma 2019', '1850', '2019-03-04'])('refuses %j', (typed) => {
    expect(readRoughDate(typed)).toBeNull();
  });

  it('reads back in words', () => {
    expect(formatRoughDate('2019')).toBe('2019');
    expect(formatRoughDate('2019-03')).toBe('March 2019');
    expect(placeSpan({ movedIn: '2019-03', movedOut: null })).toBe('Mar 2019 to now');
    expect(placeSpan({ movedIn: '2015', movedOut: '2019-08' })).toBe('2015 to Aug 2019');
  });

  it('round-trips a stored date through the form', () => {
    const draft = draftOf(place({ movedIn: '2019-03', movedOut: '2021' }));
    expect(readRoughDate(draft.movedIn)).toBe('2019-03');
    expect(readRoughDate(draft.movedOut)).toBe('2021');
  });
});

describe('checking a place', () => {
  const draft = { name: 'The flat on Elm Street', city: ' Leeds ', region: '', country: 'UK', movedIn: '2015', movedOut: '', note: '' };

  it('turns the form into the row, an empty moved-out meaning they live there now', () => {
    const checked = checkPlace(draft);
    expect(checked).toEqual({
      ok: true,
      row: {
        name: 'The flat on Elm Street',
        city: 'Leeds',
        region: null,
        country: 'UK',
        moved_in: '2015',
        moved_out: null,
        note: null,
      },
    });
  });

  it('refuses a missing name, an unreadable date and an out before an in', () => {
    const checked = checkPlace({ ...draft, name: ' ', movedIn: 'long ago', movedOut: '2014' });
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(Object.keys(checked.errors).sort()).toEqual(['movedIn', 'name']);

    const backwards = checkPlace({ ...draft, movedIn: '2015-06', movedOut: '2014' });
    expect(backwards.ok ? null : backwards.errors.movedOut).toMatch(/before you moved in/);
  });

  it('lets a move out in the same year as a month move in', () => {
    expect(checkPlace({ ...draft, movedIn: '2019-06', movedOut: '2019' }).ok).toBe(true);
  });
});

describe('the list', () => {
  const leeds = place({ name: 'Leeds', movedIn: '2015', movedOut: '2019-08' });
  const york = place({ name: 'York', movedIn: '2019-08' });
  const hull = place({ name: 'Hull', movedIn: '2010-01', movedOut: '2015' });
  const childhood = place({ name: 'Childhood home', movedIn: '1990', movedOut: '2010' });

  it('puts where they live now first, then newest first', () => {
    expect(sortPlaces([hull, york, childhood, leeds]).map((p) => p.name)).toEqual([
      'York',
      'Leeds',
      'Hull',
      'Childhood home',
    ]);
  });

  it('answers where they lived in a given year, both homes in a year they moved', () => {
    const all = [leeds, york, hull, childhood];
    expect(livedInYear(all, 2017).map((p) => p.name)).toEqual(['Leeds']);
    expect(livedInYear(all, 2019).map((p) => p.name)).toEqual(['Leeds', 'York']);
    expect(livedInYear(all, 2026).map((p) => p.name)).toEqual(['York']);
    expect(livedInYear(all, 1980)).toEqual([]);
  });

  it('says how long they lived there, as roughly as the dates allow', () => {
    expect(timeThere({ movedIn: '2019-08', movedOut: null }, '2026-10')).toBe('7 years');
    expect(timeThere({ movedIn: '2019-08', movedOut: '2020-02' }, '2026-10')).toBe('6 months');
    expect(timeThere({ movedIn: '2015', movedOut: '2019-08' }, '2026-10')).toBe('About 4 years');
    expect(timeThere({ movedIn: '2019', movedOut: '2019' }, '2026-10')).toBe('Under a year');
  });
});

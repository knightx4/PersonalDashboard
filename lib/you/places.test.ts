import { describe, expect, it } from 'vitest';
import {
  checkPlace,
  draftOf,
  formatRoughDate,
  livedInYear,
  placeFromLine,
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

describe('a place from one typed line (plan #1950.7)', () => {
  const read = (text: string) => {
    const draft = placeFromLine(text);
    if ('error' in draft) throw new Error(draft.error);
    return { name: draft.name, movedIn: draft.movedIn, movedOut: draft.movedOut };
  };

  it('takes the dates from the end and the rest as the name', () => {
    expect(read('12 Oak Street, Leeds, 2019 to 2021')).toEqual({
      name: '12 Oak Street, Leeds',
      movedIn: '2019',
      movedOut: '2021',
    });
    expect(read('Leeds from March 2019 until Aug 2021')).toEqual({
      name: 'Leeds',
      movedIn: 'March 2019',
      movedOut: 'Aug 2021',
    });
    expect(read('The flat on Kerr Street 2019-2021')).toEqual({
      name: 'The flat on Kerr Street',
      movedIn: '2019',
      movedOut: '2021',
    });
    expect(read('Oak Street 3/2019 – now')).toEqual({ name: 'Oak Street', movedIn: '3/2019', movedOut: '' });
  });

  it('reads one date as the home they live in now', () => {
    expect(read('Leeds since March 2019')).toEqual({ name: 'Leeds', movedIn: 'March 2019', movedOut: '' });
    expect(read('Marylebone, 2019')).toEqual({ name: 'Marylebone', movedIn: '2019', movedOut: '' });
    expect(read('Flat 4, 2019-03')).toEqual({ name: 'Flat 4', movedIn: '2019-03', movedOut: '' });
  });

  it('asks for a date when there is none, and leaves an empty name to checkPlace', () => {
    expect(placeFromLine('Oak Street')).toHaveProperty('error');
    const bare = placeFromLine('2019');
    if ('error' in bare) throw new Error(bare.error);
    expect(checkPlace(bare)).toMatchObject({ ok: false, errors: { name: expect.any(String) } });
  });

  it('goes through checkPlace into the row', () => {
    const draft = placeFromLine('Leeds, Mar 2019 to 2021');
    if ('error' in draft) throw new Error(draft.error);
    expect(checkPlace(draft)).toMatchObject({
      ok: true,
      row: { name: 'Leeds', moved_in: '2019-03', moved_out: '2021', city: null },
    });
  });
});

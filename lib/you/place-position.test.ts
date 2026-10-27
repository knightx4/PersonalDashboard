import { describe, expect, it } from 'vitest';
import { countryCode, normaliseName, placePosition, positionForSave } from './place-position';

/** A place's map position from its city, against the bundled list (plan #2091.3). */

const where = (city: string | null, region: string | null = null, country: string | null = null) => ({
  city,
  region,
  country,
});

/** Rough bounding boxes, enough to tell one state from another. */
const STATES = {
  TX: { lat: [25.8, 36.5], lon: [-106.7, -93.5] },
  CO: { lat: [36.9, 41.1], lon: [-109.1, -102.0] },
  ID: { lat: [41.9, 49.1], lon: [-117.3, -111.0] },
  OR: { lat: [41.9, 46.3], lon: [-124.7, -116.4] },
  IL: { lat: [36.9, 42.6], lon: [-91.6, -87.0] },
  ME: { lat: [42.9, 47.5], lon: [-71.1, -66.9] },
  NY: { lat: [40.4, 45.1], lon: [-79.8, -71.8] },
} as const;

function inState(position: ReturnType<typeof placePosition>, state: keyof typeof STATES): boolean {
  if (!position) return false;
  const box = STATES[state];
  return (
    position.latitude >= box.lat[0] &&
    position.latitude <= box.lat[1] &&
    position.longitude >= box.lon[0] &&
    position.longitude <= box.lon[1]
  );
}

describe('placePosition', () => {
  it.each([
    ['Boise', 'ID'],
    ["Coeur d'Alene", 'ID'],
    ['Waco', 'TX'],
    ['Denver', 'CO'],
    ['Portland', 'OR'],
    ['Chicago', 'IL'],
  ] as const)('puts %s, %s, USA in its state', (city, state) => {
    expect(inState(placePosition(where(city, state, 'USA')), state)).toBe(true);
  });

  it('takes the region and country written out or in short', () => {
    const short = placePosition(where('Waco', 'TX', 'US'));
    expect(placePosition(where('Waco', 'Texas', 'United States'))).toEqual(short);
    expect(placePosition(where('waco', 'texas', 'U.S.A.'))).toEqual(short);
  });

  it('never places a city in a region that does not have one of that name', () => {
    expect(placePosition(where('Waco', 'CT', 'USA'))).toBeNull();
    expect(placePosition(where('Boise', 'TX', 'USA'))).toBeNull();
  });

  it('keeps the region apart when two states share a city name', () => {
    const maine = placePosition(where('Portland', 'ME', 'USA'));
    expect(maine).not.toBeNull();
    expect(inState(maine, 'OR')).toBe(false);
    expect(inState(maine, 'ME')).toBe(true);
  });

  it('takes the largest of the name when no region is given', () => {
    expect(inState(placePosition(where('Denver')), 'CO')).toBe(true);
    expect(inState(placePosition(where('Portland', null, 'USA')), 'OR')).toBe(true);
  });

  it('places nothing for an empty or unknown city, or a country it does not know', () => {
    expect(placePosition(where(null, 'TX', 'USA'))).toBeNull();
    expect(placePosition(where('  ', 'TX', 'USA'))).toBeNull();
    expect(placePosition(where('Nowhere In Particular', 'TX', 'USA'))).toBeNull();
    expect(placePosition(where('Waco', 'TX', 'Atlantis'))).toBeNull();
  });

  it('reads the names people write for cities the list spells otherwise', () => {
    expect(inState(placePosition(where('New York', 'NY', 'USA')), 'NY')).toBe(true);
    expect(inState(placePosition(where('NYC')), 'NY')).toBe(true);
    expect(placePosition(where('Washington', 'DC', 'USA'))).toEqual(placePosition(where('Washington DC')));
    expect(placePosition(where('Bronx', 'NY'))).toEqual(placePosition(where('The Bronx', 'NY')));
  });

  it('reads places outside the United States, with region names or abbreviations', () => {
    const london = placePosition(where('London', null, 'UK'));
    expect(london?.latitude).toBeCloseTo(51.5, 0);
    expect(placePosition(where('London', 'Ontario', 'Canada'))?.longitude).toBeCloseTo(-81.2, 0);
    expect(placePosition(where('Toronto', 'ON', 'CA'))).toEqual(placePosition(where('Toronto', 'Ontario')));
    expect(placePosition(where('Montréal', 'Québec', 'Canada'))).toEqual(placePosition(where('Montreal', 'QC')));
    expect(placePosition(where('Munich', null, 'Germany'))).toEqual(placePosition(where('Munich', 'Bavaria', 'DE')));
  });
});

describe('normaliseName and countryCode', () => {
  it('writes out short forms and drops accents and punctuation', () => {
    expect(normaliseName('St. Louis')).toBe('saint louis');
    expect(normaliseName('Ft Worth')).toBe('fort worth');
    expect(normaliseName('Coeur d’Alene')).toBe('coeur dalene');
    expect(normaliseName('São Paulo')).toBe('sao paulo');
  });

  it('knows a country by code, three-letter code, name or common name', () => {
    expect(countryCode('USA')).toBe('US');
    expect(countryCode('united states')).toBe('US');
    expect(countryCode('England')).toBe('GB');
    expect(countryCode('Narnia')).toBeNull();
  });
});

describe('positionForSave', () => {
  const waco = placePosition(where('Waco', 'TX', 'USA'))!;
  const before = (fields: Partial<{ city: string | null; latitude: number | null; longitude: number | null }>) => ({
    city: 'Waco',
    region: 'TX',
    country: 'USA',
    latitude: null,
    longitude: null,
    ...fields,
  });

  it('gives a new place its city’s position, or nothing', () => {
    expect(positionForSave(null, where('Waco', 'TX', 'USA'))).toEqual(waco);
    expect(positionForSave(null, where('Nowhere In Particular'))).toEqual({});
  });

  it('leaves a place’s position alone when its where has not changed', () => {
    const byHand = before({ latitude: 10, longitude: 20 });
    expect(positionForSave(byHand, where('waco', 'tx', 'USA'))).toEqual({});
  });

  it('fills a position that was empty when the city is known', () => {
    expect(positionForSave(before({}), where('Waco', 'TX', 'USA'))).toEqual(waco);
    expect(positionForSave(before({ city: 'Nowhere' }), where('Nowhere', 'TX', 'USA'))).toEqual({});
  });

  it('moves the position with the city, and clears it for a city it cannot place', () => {
    const placed = before({ latitude: waco.latitude, longitude: waco.longitude });
    expect(positionForSave(placed, where('Austin', 'TX', 'USA'))).toEqual(
      placePosition(where('Austin', 'TX', 'USA')),
    );
    expect(positionForSave(placed, where('Nowhere In Particular', 'TX', 'USA'))).toEqual({
      latitude: null,
      longitude: null,
    });
  });
});

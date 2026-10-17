import { CITIES, COUNTRIES } from './cities-data';
import type { Place } from './places';

/**
 * Where a place is on the map, worked out from its city, region and country
 * against the city list shipped with the app (plan #2091.3). Nothing is sent
 * anywhere (decision #2091.1), and the place's name, which is often a street
 * address, is never read: only the city, region and country.
 *
 * Pure apart from parsing the list once on first use. Server only: the list
 * is a few hundred kilobytes, so the client form and the gallery never
 * import this file.
 */

export type MapPosition = { latitude: number; longitude: number };

export type PlaceWhere = Pick<Place, 'city' | 'region' | 'country'>;

type City = { region: string; country: string; latitude: number; longitude: number };

/** Lower case, accents and punctuation gone, and the usual short forms written out. */
export function normaliseName(text: string): string {
  const words = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((word) => SHORT_FORMS[word] ?? word);
  if (words[0] === 'the' && words.length > 1) words.shift();
  return words.join(' ');
}

const SHORT_FORMS: Record<string, string> = {
  st: 'saint',
  ste: 'sainte',
  ft: 'fort',
  mt: 'mount',
};

/** Names people write for a city that the list spells another way. */
const CITY_ALIASES: Record<string, { city: string; region?: string; country?: string }> = {
  'new york': { city: 'new york city' },
  nyc: { city: 'new york city', region: 'NY', country: 'US' },
  'washington dc': { city: 'washington', region: 'DC', country: 'US' },
  'washington district of columbia': { city: 'washington', region: 'DC', country: 'US' },
};

/** Names for countries beyond the code, the three-letter code and the list's own name. */
const COUNTRY_ALIASES: Record<string, string> = {
  america: 'US',
  'united states of america': 'US',
  uk: 'GB',
  'great britain': 'GB',
  britain: 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'northern ireland': 'GB',
  holland: 'NL',
  korea: 'KR',
  'republic of korea': 'KR',
  czechia: 'CZ',
  'czech republic': 'CZ',
  russia: 'RU',
  'ivory coast': 'CI',
};

/** Two-letter abbreviations for regions, where people write them that way. */
const REGION_CODES: Record<string, Record<string, string>> = {
  US: {
    alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
    connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA',
    hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS',
    kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA',
    michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
    nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM',
    'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
    oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
    'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA',
    washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'puerto rico': 'PR',
  },
  CA: {
    alberta: 'AB', 'british columbia': 'BC', manitoba: 'MB', 'new brunswick': 'NB',
    'newfoundland and labrador': 'NL', 'nova scotia': 'NS', ontario: 'ON', 'prince edward island': 'PE',
    quebec: 'QC', saskatchewan: 'SK', 'northwest territories': 'NT', nunavut: 'NU', yukon: 'YT',
  },
  AU: {
    'new south wales': 'NSW', victoria: 'VIC', queensland: 'QLD', 'western australia': 'WA',
    'south australia': 'SA', tasmania: 'TAS', 'australian capital territory': 'ACT',
    'northern territory': 'NT',
  },
};

type Lists = { cities: Map<string, City[]>; countries: Map<string, string> };
let lists: Lists | null = null;

function load(): Lists {
  if (lists) return lists;
  const countries = new Map<string, string>();
  for (const line of COUNTRIES.split('\n')) {
    if (!line) continue;
    const [code, code3, name] = line.split('|');
    for (const key of [code, code3, name]) countries.set(normaliseName(key), code);
  }
  for (const [name, code] of Object.entries(COUNTRY_ALIASES)) countries.set(normaliseName(name), code);

  const cities = new Map<string, City[]>();
  for (const line of CITIES.split('\n')) {
    if (!line) continue;
    const [name, region, country, latitude, longitude] = line.split('|');
    const key = normaliseName(name);
    const entry = { region, country, latitude: Number(latitude), longitude: Number(longitude) };
    const found = cities.get(key);
    if (found) found.push(entry);
    else cities.set(key, [entry]);
  }
  lists = { cities, countries };
  return lists;
}

/** The two-letter code for a country as written, or null when it is not one the list knows. */
export function countryCode(text: string): string | null {
  const key = normaliseName(text);
  return key ? (load().countries.get(key) ?? null) : null;
}

/** Whether a region as written names the city's region: its name, or its abbreviation. */
function sameRegion(written: string, city: City): boolean {
  const key = normaliseName(written);
  if (!key) return true;
  const codes = REGION_CODES[city.country];
  if (codes) {
    const cityCode = city.region.length <= 3 ? city.region : codes[normaliseName(city.region)];
    const writtenCode = codes[key] ?? key.toUpperCase();
    if (cityCode && cityCode.toUpperCase() === writtenCode) return true;
  }
  return normaliseName(city.region) === key;
}

/**
 * The place's position from its city, or null when the city is empty or not
 * in the list. A region or country that is filled in has to match: Brooklyn,
 * NY is never put in Ohio, and a country the list does not know places
 * nothing rather than guess. With neither, the most populous city of that
 * name is taken.
 */
export function placePosition(where: PlaceWhere): MapPosition | null {
  const cityText = where.city?.trim() ?? '';
  if (!cityText) return null;
  const { cities } = load();

  let key = normaliseName(cityText);
  let region = where.region?.trim() ?? '';
  let country: string | null = null;
  const countryText = where.country?.trim() ?? '';
  if (countryText) {
    country = countryCode(countryText);
    if (!country) return null;
  }

  const alias = CITY_ALIASES[key];
  if (alias && !cities.has(key)) {
    key = alias.city;
    if (alias.country && country && alias.country !== country) return null;
    if (alias.region && !region) region = alias.region;
    if (alias.country && !country) country = alias.country;
  } else if (alias) {
    // A name that is a city of its own as well, such as New York: try the
    // alias first, since it is the one people mean.
    const aliased = cities.get(alias.city)?.find(
      (city) => (!country || city.country === country) && sameRegion(region, city),
    );
    if (aliased) return { latitude: aliased.latitude, longitude: aliased.longitude };
  }

  const match = cities
    .get(key)
    ?.find((city) => (!country || city.country === country) && sameRegion(region, city));
  return match ? { latitude: match.latitude, longitude: match.longitude } : null;
}

type Positioned = PlaceWhere & { latitude: number | null; longitude: number | null };

function sameWhere(a: PlaceWhere, b: PlaceWhere): boolean {
  const norm = (text: string | null) => normaliseName(text ?? '');
  return norm(a.city) === norm(b.city) && norm(a.region) === norm(b.region) && norm(a.country) === norm(b.country);
}

/**
 * The position columns a save writes, given the place before it (null for a
 * new one) and its city, region and country after. Empty when the position
 * should be left as it is.
 *
 * A new place gets its city's position, or none. A place whose city, region
 * or country changed gets the new city's position, or loses its old one,
 * which would now be wrong. A place whose where is unchanged keeps the
 * position it has, so one set by hand is never overwritten, and gets one
 * only when it had none and its city is now in the list.
 */
export function positionForSave(
  before: Positioned | null,
  after: PlaceWhere,
): { latitude: number | null; longitude: number | null } | Record<string, never> {
  const found = placePosition(after);
  if (!before) return found ?? {};
  if (!sameWhere(before, after)) return found ?? { latitude: null, longitude: null };
  if (typeof before.latitude === 'number' && typeof before.longitude === 'number') return {};
  return found ?? {};
}

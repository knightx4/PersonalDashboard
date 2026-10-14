/**
 * The places the person has lived (plan #1991.5): you.places, as the Places
 * tab, Dash's write tools and their tests read it.
 *
 * A date is a year or a year and month, kept as 'YYYY' or 'YYYY-MM'
 * (supabase/migrations-you/0004_places.sql), because few people remember the
 * day they moved. No moved-out date means they live there now.
 *
 * No server imports, so the client form and the gallery can use it.
 */

export type Place = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  country: string | null;
  /** 'YYYY' or 'YYYY-MM'. */
  movedIn: string;
  /** 'YYYY' or 'YYYY-MM'; null while they live there. */
  movedOut: string | null;
  note: string | null;
};

/** The columns a place is read with, in the order the row type lists them. */
export const PLACE_COLUMNS = 'id, name, city, region, country, moved_in, moved_out, note';

export type PlaceRow = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  country: string | null;
  moved_in: string;
  moved_out: string | null;
  note: string | null;
};

export function placeFromRow(row: PlaceRow): Place {
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    region: row.region,
    country: row.country,
    movedIn: row.moved_in,
    movedOut: row.moved_out,
    note: row.note,
  };
}

export const NAME_MAX = 200;
export const NOTE_MAX = 4000;

const ROUGH_DATE = /^(\d{4})(?:-(0[1-9]|1[0-2]))?$/;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * A rough date as typed, read into 'YYYY' or 'YYYY-MM', or null when it is
 * neither. Takes '2019', '2019-3', '2019-03', '2019/03', '3/2019',
 * 'March 2019' and 'Mar 2019'.
 */
export function readRoughDate(value: string): string | null {
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text) return null;

  let year: number | null = null;
  let month: number | null = null;

  const isoish = /^(\d{4})(?:[-/.](\d{1,2}))?$/.exec(text);
  const monthFirst = /^(\d{1,2})[-/.](\d{4})$/.exec(text);
  const named = /^([A-Za-z]+)\.? (\d{4})$/.exec(text);
  if (isoish) {
    year = Number(isoish[1]);
    month = isoish[2] ? Number(isoish[2]) : null;
  } else if (monthFirst) {
    year = Number(monthFirst[2]);
    month = Number(monthFirst[1]);
  } else if (named) {
    const word = named[1].toLowerCase();
    const index = word.length >= 3 ? MONTHS.findIndex((m) => m.toLowerCase().startsWith(word)) : -1;
    if (index === -1) return null;
    year = Number(named[2]);
    month = index + 1;
  } else {
    return null;
  }

  if (year < 1900 || year > 2200) return null;
  if (month === null) return String(year);
  if (month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Whether a stored value is a rough date in the stored form. */
export function isRoughDate(value: string): boolean {
  return ROUGH_DATE.test(value);
}

/** 'March 2019', or '2019' for a year alone. */
export function formatRoughDate(value: string): string {
  const match = ROUGH_DATE.exec(value);
  if (!match) return value;
  return match[2] ? `${MONTHS[Number(match[2]) - 1]} ${match[1]}` : match[1];
}

/** 'Mar 2019', for the list's narrow column. */
export function formatRoughDateShort(value: string): string {
  const match = ROUGH_DATE.exec(value);
  if (!match) return value;
  return match[2] ? `${MONTHS[Number(match[2]) - 1].slice(0, 3)} ${match[1]}` : match[1];
}

/** '2019 to Mar 2021', or '2019 to now'. */
export function placeSpan(place: Pick<Place, 'movedIn' | 'movedOut'>): string {
  const from = formatRoughDateShort(place.movedIn);
  return `${from} to ${place.movedOut ? formatRoughDateShort(place.movedOut) : 'now'}`;
}

/** Whether the out date is no earlier than the in date, comparing by year where either is a year alone. */
export function inBeforeOut(movedIn: string, movedOut: string | null): boolean {
  if (movedOut === null) return true;
  return movedOut >= movedIn || movedOut.slice(0, 4) === movedIn.slice(0, 4);
}

/** City, region and country, as one line: 'Leeds, West Yorkshire, United Kingdom'. */
export function placeWhere(place: Pick<Place, 'city' | 'region' | 'country'>): string {
  return [place.city, place.region, place.country].filter((part): part is string => !!part).join(', ');
}

/** Whether this is a home they still live in. */
export function isCurrent(place: Pick<Place, 'movedOut'>): boolean {
  return place.movedOut === null;
}

/**
 * Newest first: the homes they live in now, then by when they moved in, the
 * latest first. A year alone sorts before a month in the same year, which is
 * the order the text forms sort in.
 */
export function sortPlaces<P extends Pick<Place, 'movedIn' | 'movedOut' | 'name'>>(places: readonly P[]): P[] {
  return [...places].sort((a, b) => {
    const current = Number(isCurrent(b)) - Number(isCurrent(a));
    if (current !== 0) return current;
    if (a.movedIn !== b.movedIn) return a.movedIn < b.movedIn ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * The places they lived in during a year: moved in that year or before, and
 * moved out that year or after, or not at all. A year counts as reached by a
 * move in any month of it.
 */
export function livedInYear<P extends Pick<Place, 'movedIn' | 'movedOut'>>(
  places: readonly P[],
  year: number,
): P[] {
  return places.filter((place) => {
    const inYear = Number(place.movedIn.slice(0, 4));
    const outYear = place.movedOut ? Number(place.movedOut.slice(0, 4)) : Infinity;
    return inYear <= year && year <= outYear;
  });
}

/** What the form and Dash's tools send, before it is checked. */
export type PlaceDraft = {
  name: string;
  city: string;
  region: string;
  country: string;
  movedIn: string;
  movedOut: string;
  note: string;
};

/** A place as written to the row, or the sentences saying what is wrong, by field. */
export type PlaceChecked =
  | {
      ok: true;
      row: Omit<PlaceRow, 'id'>;
    }
  | { ok: false; errors: Partial<Record<keyof PlaceDraft, string>> };

function optional(value: string): string | null {
  const text = value.trim();
  return text ? text : null;
}

/** Checks a draft and turns it into the row's columns. An empty moved-out means they live there now. */
export function checkPlace(draft: PlaceDraft): PlaceChecked {
  const errors: Partial<Record<keyof PlaceDraft, string>> = {};
  const name = draft.name.trim();
  if (!name) errors.name = 'Give it a name, even if it is only the city.';
  else if (name.length > NAME_MAX) errors.name = `Keep the name under ${NAME_MAX} characters.`;

  for (const key of ['city', 'region', 'country'] as const) {
    if (draft[key].trim().length > NAME_MAX) errors[key] = `Keep it under ${NAME_MAX} characters.`;
  }

  const movedIn = readRoughDate(draft.movedIn);
  if (!draft.movedIn.trim()) errors.movedIn = 'Say when you moved in: a year is enough.';
  else if (!movedIn) errors.movedIn = 'Write a year, or a month and year, such as 2019 or March 2019.';

  const movedOutText = draft.movedOut.trim();
  const movedOut = movedOutText ? readRoughDate(movedOutText) : null;
  if (movedOutText && !movedOut) {
    errors.movedOut = 'Write a year, or a month and year, or leave it empty if you live there now.';
  } else if (movedIn && movedOut && !inBeforeOut(movedIn, movedOut)) {
    errors.movedOut = 'You moved out before you moved in. Check the two dates.';
  }

  const note = draft.note.trim();
  if (note.length > NOTE_MAX) errors.note = `Keep the note under ${NOTE_MAX} characters.`;

  if (Object.keys(errors).length > 0 || !movedIn) return { ok: false, errors };
  return {
    ok: true,
    row: {
      name,
      city: optional(draft.city),
      region: optional(draft.region),
      country: optional(draft.country),
      moved_in: movedIn,
      moved_out: movedOut,
      note: note || null,
    },
  };
}

/** A rough date as it may be typed in a line: '2019', '2019-03', '3/2019', 'March 2019'. */
const MONTH_WORD = `(?:${[...MONTHS, ...MONTHS.map((m) => m.slice(0, 3)), 'Sept'].join('|')})`;
const DATE_IN_LINE = String.raw`(?:${MONTH_WORD}\.? \d{4}|\d{1,2}[-/.]\d{4}|\d{4}(?:[-/.]\d{1,2})?)`;
const RANGE_AT_END = new RegExp(
  String.raw`(?:^|[\s,])(?:from\s+)?(${DATE_IN_LINE})\s*(?:to|until|till|through|-|–|—)\s*(${DATE_IN_LINE}|now|today|present)\s*\.?$`,
  'i',
);
const ONE_DATE_AT_END = new RegExp(String.raw`(?:^|[\s,])(?:(?:since|from|in)\s+)?(${DATE_IN_LINE})\s*\.?$`, 'i');

/**
 * A place from one typed line, as capture's Add a place takes it (plan
 * #1950.7): what it is called, then when, at the end. '12 Oak Street,
 * Leeds, 2019 to 2021' is a home they moved out of; 'Leeds since March
 * 2019' or 'Leeds, 2019' one they live in now. Everything before the dates
 * is the name; the city, region, country and note are set on the place's
 * own page. The draft goes through checkPlace like the form's, so a bad
 * date is refused in the same words.
 */
export function placeFromLine(text: string): PlaceDraft | { error: string } {
  const line = text.trim().replace(/\s+/g, ' ');
  const range = RANGE_AT_END.exec(line);
  const one = range ? null : ONE_DATE_AT_END.exec(line);
  const match = range ?? one;
  if (!match) return { error: 'Put the dates after the name, such as Leeds, 2019 to 2021.' };

  const out = range ? range[2] : '';
  const draft = draftOf(null);
  draft.movedIn = match[1];
  draft.movedOut = /^(now|today|present)$/i.test(out) ? '' : out;
  draft.name = line
    .slice(0, match.index)
    .replace(/[\s,;:–—-]+$/, '')
    .trim();
  return draft;
}

/** A place's fields as the form shows them, for editing. */
export function draftOf(place: Place | null): PlaceDraft {
  return {
    name: place?.name ?? '',
    city: place?.city ?? '',
    region: place?.region ?? '',
    country: place?.country ?? '',
    movedIn: place ? formatRoughDate(place.movedIn) : '',
    movedOut: place?.movedOut ? formatRoughDate(place.movedOut) : '',
    note: place?.note ?? '',
  };
}

/**
 * How long they lived there, as roughly as the dates allow: '4 years',
 * '8 months', 'Under a year'. `thisMonth` is 'YYYY-MM', for a home they still
 * live in. Months are counted only when both ends have one; otherwise whole
 * years, and a stay inside one year is 'Under a year'.
 */
export function timeThere(place: Pick<Place, 'movedIn' | 'movedOut'>, thisMonth: string): string {
  const end = place.movedOut ?? thisMonth;
  const [inYear, inMonth] = place.movedIn.split('-').map(Number);
  const [outYear, outMonth] = end.split('-').map(Number);
  if (inMonth && outMonth) {
    const months = (outYear - inYear) * 12 + (outMonth - inMonth);
    if (months < 1) return 'Under a month';
    if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'}`;
    const years = Math.floor(months / 12);
    return `${years} ${years === 1 ? 'year' : 'years'}`;
  }
  const years = outYear - inYear;
  if (years < 1) return 'Under a year';
  return `About ${years} ${years === 1 ? 'year' : 'years'}`;
}

export const placeHref = (id: string) => `/you/places/${id}`;

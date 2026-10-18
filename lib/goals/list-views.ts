/**
 * The views over a goal's list (plan #2330.4): which ones its rows can fill,
 * which it opens on, and what the calendar and the map draw.
 *
 * A list offers a view when what it holds can fill one. An own list says so
 * by its field types (an image field, a date field, a place field), so a list
 * of shops with a place field offers the map before any shop has an address,
 * and the map then says how to put one there. A linked list says so by its
 * kinds: events have dates and places, saved products have pictures. Every
 * list has the table.
 *
 * It opens on the most useful view its rows fill now: Compare when a row has
 * a picture, then the calendar when one has a date, then the map when one has
 * a place, else the table. The view last chosen is kept per list in the
 * browser (lib/goals/list-view-memory.ts) and wins while the list still
 * offers it.
 *
 * Pure, so the choice, the month grid and the pins are tested without a page.
 */

import { whenDate, whenMonth } from '@/lib/core/when';
import type { ListRowView, ListView } from '@/lib/goals/goal-lists';

export const LIST_VIEW_KINDS = ['compare', 'gallery', 'calendar', 'map', 'table'] as const;

export type ListViewKind = (typeof LIST_VIEW_KINDS)[number];

export const LIST_VIEW_LABELS: Record<ListViewKind, string> = {
  compare: 'Compare',
  gallery: 'Gallery',
  calendar: 'Calendar',
  map: 'Map',
  table: 'Table',
};

export function isListViewKind(value: unknown): value is ListViewKind {
  return typeof value === 'string' && (LIST_VIEW_KINDS as readonly string[]).includes(value);
}

/** Every row of the list, in play and ruled out. */
function allRows(list: Pick<ListView, 'rows' | 'ruledOut'>): ListRowView[] {
  return [...list.rows, ...list.ruledOut];
}

/** The views a list offers, in the order the switch shows them. */
export function viewsFor(list: Pick<ListView, 'holds' | 'rows' | 'ruledOut'>): ListViewKind[] {
  const rows = allRows(list);
  const pictures = list.holds.pictures || rows.some((r) => r.picture);
  const dates = list.holds.dates || rows.some((r) => r.day);
  const places = list.holds.places || rows.some((r) => r.place);
  const out: ListViewKind[] = [];
  if (pictures) out.push('compare', 'gallery');
  if (dates) out.push('calendar');
  if (places) out.push('map');
  out.push('table');
  return out;
}

/** The view a list opens on when nothing was chosen: the first its rows fill now. */
export function defaultView(list: Pick<ListView, 'holds' | 'rows' | 'ruledOut'>): ListViewKind {
  const offered = viewsFor(list);
  const rows = list.rows;
  if (offered.includes('compare') && rows.some((r) => r.picture)) return 'compare';
  if (offered.includes('calendar') && rows.some((r) => r.day)) return 'calendar';
  if (offered.includes('map') && rows.some((r) => r.place)) return 'map';
  return 'table';
}

/** The view to draw: the one kept for the list while it still offers it, else its default. */
export function pickView(list: Pick<ListView, 'holds' | 'rows' | 'ruledOut'>, kept: string | null | undefined): ListViewKind {
  if (isListViewKind(kept) && viewsFor(list).includes(kept)) return kept;
  return defaultView(list);
}

// ---------------------------------------------------------------- calendar

/** One day square of the month grid. */
export type MonthDay = {
  /** YYYY-MM-DD. */
  day: string;
  /** The day of the month, for the square's corner. */
  date: number;
  inMonth: boolean;
  isToday: boolean;
  rows: ListRowView[];
};

export type ListMonth = {
  /** YYYY-MM. */
  month: string;
  /** "October 2026". */
  label: string;
  /** Monday-first weeks, as many as the month spans (four to six). */
  weeks: MonthDay[][];
  /** How many of the list's rows fall in this month. */
  count: number;
};

const DAY_MS = 86_400_000;

function utcOf(day: string): number {
  return Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
}

function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** A YYYY-MM `by` months after `month`. */
export function shiftMonth(month: string, by: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + by;
  const year = Math.floor(index / 12);
  return `${String(year).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/**
 * The month the calendar opens on: this month while anything is still to
 * come in it or after it, else the month of the latest row, so a list of
 * last spring's events opens on last spring rather than on an empty grid.
 */
export function monthToOpen(rows: readonly ListRowView[], today: string): string {
  const days = rows.flatMap((r) => (r.day ? [r.day] : [])).sort();
  const thisMonth = today.slice(0, 7);
  if (days.length === 0 || days.some((d) => d >= today) || days.some((d) => d.startsWith(thisMonth))) {
    return thisMonth;
  }
  return days[days.length - 1].slice(0, 7);
}

/** The month as a grid of Monday-first weeks, each day with the rows that fall on it. */
export function listMonth(rows: readonly ListRowView[], month: string, today: string): ListMonth {
  const first = utcOf(`${month}-01`);
  const next = utcOf(`${shiftMonth(month, 1)}-01`);
  // getUTCDay: 0 is Sunday. Monday-first, so Sunday sits at the end.
  const lead = (new Date(first).getUTCDay() + 6) % 7;
  const start = first - lead * DAY_MS;
  const byDay = new Map<string, ListRowView[]>();
  for (const row of rows) {
    if (!row.day) continue;
    byDay.set(row.day, [...(byDay.get(row.day) ?? []), row]);
  }
  const weeks: MonthDay[][] = [];
  for (let at = start; at < next; at += 7 * DAY_MS) {
    const week: MonthDay[] = [];
    for (let i = 0; i < 7; i++) {
      const day = dayOf(at + i * DAY_MS);
      week.push({
        day,
        date: Number(day.slice(8, 10)),
        inMonth: day.startsWith(month),
        isToday: day === today,
        rows: byDay.get(day) ?? [],
      });
    }
    weeks.push(week);
  }
  const count = rows.filter((r) => r.day?.startsWith(month)).length;
  return { month, label: whenMonth(month, { timeZone: 'UTC' }), weeks, count };
}

/** What is coming, soonest first: rows dated today or later, at most `limit`. */
export function comingUp(rows: readonly ListRowView[], today: string, limit = 5): (ListRowView & { day: string })[] {
  return rows
    .filter((r): r is ListRowView & { day: string } => r.day !== null && r.day >= today)
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(0, limit);
}

/** A row's day as the calendar's list says it: "Fri 23 Oct". */
export function dayLine(day: string, today: string): string {
  return whenDate(day, { timeZone: 'UTC', weekday: 'short', year: 'auto', now: `${today}T12:00:00Z` });
}

// ---------------------------------------------------------------- map

export type MapPin = {
  /** 1 for the first row with a point, and so on down the list. */
  n: number;
  row: ListRowView;
  lat: number;
  lng: number;
  address: string;
};

/**
 * The rows the map can put a pin on, numbered in the list's order, and the
 * ones with an address but no point. Nothing turns an address into a point
 * yet, so a place typed as an address alone is listed under the map rather
 * than guessed at.
 */
export function mapPins(rows: readonly ListRowView[]): { pins: MapPin[]; unpinned: ListRowView[] } {
  const pins: MapPin[] = [];
  const unpinned: ListRowView[] = [];
  for (const row of rows) {
    const place = row.place;
    if (!place) continue;
    if (typeof place.lat === 'number' && typeof place.lng === 'number' && validPoint(place.lat, place.lng)) {
      pins.push({ n: pins.length + 1, row, lat: place.lat, lng: place.lng, address: place.address });
    } else {
      unpinned.push(row);
    }
  }
  return { pins, unpinned };
}

function validPoint(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

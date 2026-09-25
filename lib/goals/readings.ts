/**
 * Goals measured by a number, and the dated readings of it (plan #930).
 *
 * A goal such as paying off a debt or lifting a heavier bench names its unit
 * and, optionally, the value it is aiming for (goals.items.unit and .target).
 * Every time the number is given it is a new row in goals.readings with its
 * date; the database refuses to change a reading's value afterwards, so the
 * series is the record. This file holds the rules and the chart geometry; the
 * reads and writes are in lib/goals/readings-store.ts.
 */

import type { CollectionField, FieldType } from '@/lib/goals/collections';

/** The limits the table's checks set (supabase/migrations-goals/0004 and 0001). */
export const UNIT_MAX = 40;
export const READING_NOTE_MAX = 2000;
/** Bigger than any balance or weight, small enough to stay exact in a double. */
export const READING_ABS_MAX = 1e12;

export type Reading = {
  id: string;
  value: number;
  /** YYYY-MM-DD. */
  readOn: string;
  note: string | null;
  /** Set when the reading came from the capture box. */
  captureId: string | null;
};

export type Measure = { unit: string; target: number | null };

const DAY_MS = 86_400_000;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function clean(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value === '' ? null : value;
}

/**
 * A number as a person types it: "18,250.40", "$18,250", "-3", "182.5".
 * Thousands separators, spaces and one leading currency sign are allowed;
 * anything else is refused rather than guessed at.
 */
export function parseNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const stripped = raw.replace(/[,\s]/g, '').replace(/^(-?)[$£€]/, '$1');
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(stripped)) return null;
  const value = Number(stripped);
  return Number.isFinite(value) && Math.abs(value) < READING_ABS_MAX ? value : null;
}

/**
 * The unit and target from the goal's form. An empty unit stops the goal
 * being measured and clears the target with it, since the table refuses a
 * target without a unit; the readings already taken are kept.
 */
export function parseMeasureFields(
  get: (key: string) => unknown,
): Parsed<{ unit: string | null; target: number | null; dueOn?: string | null }> {
  const unit = clean(get('unit'));
  if (!unit) return { ok: true, value: { unit: null, target: null } };
  if (unit.length > UNIT_MAX) {
    return { ok: false, error: `Keep the unit under ${UNIT_MAX} characters.` };
  }
  // The goal's due date (plan #1025), sent only by the line beside the
  // heading. Absent leaves it as it is; empty clears it.
  const rawDue = get('dueOn');
  let dueOn: string | null | undefined;
  if (rawDue !== null && rawDue !== undefined) {
    dueOn = clean(rawDue);
    if (dueOn && (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn) || Number.isNaN(Date.parse(dueOn)))) {
      return { ok: false, error: 'The due date is not a date.' };
    }
  }
  const withDue = dueOn === undefined ? {} : { dueOn };
  const rawTarget = clean(get('target'));
  if (!rawTarget) return { ok: true, value: { unit, target: null, ...withDue } };
  const target = parseNumber(rawTarget);
  if (target === null) return { ok: false, error: 'The target has to be a number.' };
  return { ok: true, value: { unit, target, ...withDue } };
}

/** A new reading from the goal's form. The day defaults to today and cannot be later. */
export function parseReadingFields(
  get: (key: string) => unknown,
  today: string,
): Parsed<{ value: number; readOn: string; note: string | null }> {
  const rawValue = clean(get('value'));
  if (!rawValue) return { ok: false, error: 'Enter the number.' };
  const value = parseNumber(rawValue);
  if (value === null) return { ok: false, error: 'That is not a number.' };

  const readOn = clean(get('readOn')) ?? today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(readOn) || Number.isNaN(Date.parse(readOn))) {
    return { ok: false, error: 'That is not a date.' };
  }
  if (readOn > today) return { ok: false, error: 'Pick a day that has already happened.' };

  const note = clean(get('note'));
  if (note && note.length > READING_NOTE_MAX) {
    return { ok: false, error: `Keep the note under ${READING_NOTE_MAX} characters.` };
  }
  return { ok: true, value: { value, readOn, note } };
}

/** Oldest first; two on one day keep the order they were entered. */
export function sortReadings(readings: Reading[]): Reading[] {
  return readings
    .map((reading, index) => ({ reading, index }))
    .sort((a, b) => a.reading.readOn.localeCompare(b.reading.readOn) || a.index - b.index)
    .map((entry) => entry.reading);
}

const CURRENCY = new Set(['$', '£', '€']);

/** "$18,250.40" for a currency sign, "182.5 lb" for anything else. */
export function formatReading(value: number, unit: string | null): string {
  const number = Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const sign = value < 0 ? '-' : '';
  if (!unit) return `${sign}${number}`;
  if (CURRENCY.has(unit)) return `${sign}${unit}${number}`;
  return `${sign}${number} ${unit}`;
}

/**
 * One line on how the number has moved: the change since the first reading,
 * and how far is left to the target. Which way is progress comes from where
 * the first reading sat against the target, so a debt counts down and a
 * weight counts up. Null with no readings.
 */
export function movementLine(
  readings: Reading[],
  measure: { unit: string | null; target: number | null },
  formatDay: (isoDate: string) => string,
): string | null {
  const sorted = sortReadings(readings);
  if (sorted.length === 0) return null;
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const parts: string[] = [];

  if (sorted.length === 1) {
    parts.push(`${formatReading(last.value, measure.unit)} on ${formatDay(last.readOn)}`);
  } else {
    const change = last.value - first.value;
    parts.push(
      change === 0
        ? `No change since ${formatDay(first.readOn)}`
        : `${change > 0 ? 'Up' : 'Down'} ${formatReading(Math.abs(change), measure.unit)} since ${formatDay(first.readOn)}`,
    );
  }

  if (measure.target !== null) {
    const aimingDown = first.value > measure.target;
    const left = aimingDown ? last.value - measure.target : measure.target - last.value;
    parts.push(
      left <= 0 ? 'target reached' : `${formatReading(left, measure.unit)} to go`,
    );
  }
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// When the target will be reached (plan #1025)
// ---------------------------------------------------------------------------

/** Fewer readings than this and no projection is drawn. */
export const PROJECTION_MIN_READINGS = 3;
/** The pace is taken from this many of the latest readings. */
export const PROJECTION_RECENT = 6;
/** Further out than this is not a date worth printing. */
const PROJECTION_MAX_DAYS = 100 * 365;

export type Projection =
  | {
      kind: 'reaches';
      /** YYYY-MM-DD the target is reached at the recent pace. */
      reachOn: string;
      /** The goal's due date, or null without one. */
      dueOn: string | null;
      /** Days before the due date (negative after it); null without one. */
      daysEarly: number | null;
    }
  /** The recent readings are flat or moving away from the target. */
  | { kind: 'not-closing' };

function dayNumber(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00Z`) / DAY_MS;
}

function isoDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/**
 * When the number will reach its target at the pace of its recent readings:
 * the least-squares slope through the latest few, carried on from the latest
 * reading. Null when there is nothing to project: no target, fewer than three
 * readings, the target already reached, or every recent reading on one day.
 */
export function projectTarget(
  readings: Reading[],
  target: number | null,
  dueOn: string | null,
): Projection | null {
  if (target === null) return null;
  const sorted = sortReadings(readings);
  if (sorted.length < PROJECTION_MIN_READINGS) return null;
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  // Which way is progress, as movementLine reads it.
  const aimingDown = first.value > target;
  const left = aimingDown ? last.value - target : target - last.value;
  if (left <= 0) return null;

  const recent = sorted.slice(-PROJECTION_RECENT);
  const xs = recent.map((r) => dayNumber(r.readOn));
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = recent.reduce((a, r) => a + r.value, 0) / recent.length;
  let sxx = 0;
  let sxy = 0;
  recent.forEach((r, i) => {
    sxx += (xs[i] - meanX) ** 2;
    sxy += (xs[i] - meanX) * (r.value - meanY);
  });
  if (sxx === 0) return null;
  const perDay = sxy / sxx;
  // Progress per day, positive when closing on the target.
  const closing = aimingDown ? -perDay : perDay;
  if (closing <= 0) return { kind: 'not-closing' };
  const days = Math.ceil(left / closing);
  if (days > PROJECTION_MAX_DAYS) return { kind: 'not-closing' };

  const reachDay = dayNumber(last.readOn) + days;
  return {
    kind: 'reaches',
    reachOn: isoDay(reachDay),
    dueOn,
    daysEarly: dueOn === null ? null : Math.round(dayNumber(dueOn) - reachDay),
  };
}

/** "3 days", "5 weeks", "4 months", "2 years", rounded to the nearest. */
export function spanWords(days: number): string {
  const n = Math.abs(days);
  const words = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'}`;
  if (n < 14) return words(n, 'day');
  if (n < 61) return words(Math.round(n / 7), 'week');
  if (n < 730) return words(Math.round(n / 30.44), 'month');
  return words(Math.round(n / 365.25), 'year');
}

/**
 * The projection as one line: when the target is reached at this pace, and
 * whether that is ahead of the goal's due date or behind it.
 */
export function projectionLine(
  projection: Projection,
  formatDay: (isoDate: string) => string,
): string {
  if (projection.kind === 'not-closing') {
    return 'Not closing on the target at the recent pace';
  }
  const reach = `At this pace, target reached ${formatDay(projection.reachOn)}`;
  if (projection.dueOn === null || projection.daysEarly === null) return reach;
  const due = formatDay(projection.dueOn);
  if (projection.daysEarly === 0) return `${reach}, on the due date`;
  return projection.daysEarly > 0
    ? `${reach}: ahead, ${spanWords(projection.daysEarly)} before the due date of ${due}`
    : `${reach}: behind, ${spanWords(projection.daysEarly)} after the due date of ${due}`;
}

// ---------------------------------------------------------------------------
// The number worked out from a collection (plan #1024)
// ---------------------------------------------------------------------------

/**
 * How a goal's number is worked out from a collection
 * (goals.items.number_from_how): the total of one field over every record,
 * the value on the record whose figures are newest, or how many records there
 * are. The database writes the readings (supabase/migrations-goals/0028).
 */
export const NUMBER_FROM_HOWS = ['sum', 'latest', 'count'] as const;
export type NumberFromHow = (typeof NUMBER_FROM_HOWS)[number];

export type NumberFrom = {
  collectionId: string;
  /** Null only for a count of every record. */
  field: string | null;
  how: NumberFromHow;
};

/** A collection serving the goal, as far as working out its number needs. */
export type NumberSource = { id: string; name: string; fields: CollectionField[] };

export type NumberFromChoice = {
  /** What the picker sends: how, collection and field joined by "|". */
  value: string;
  label: string;
  from: NumberFrom;
  /** The unit a goal with none takes when this is chosen. */
  unit: string;
};

const NUMBER_TYPES: ReadonlySet<FieldType> = new Set(['number', 'money', 'percent']);

export function numberFromValue(from: NumberFrom): string {
  return `${from.how}|${from.collectionId}|${from.field ?? ''}`;
}

function unitFor(field: CollectionField): string {
  if (field.type === 'money') return '$';
  if (field.type === 'percent') return '%';
  return field.label.toLowerCase().slice(0, UNIT_MAX);
}

/**
 * Every way the goal's number could be worked out from the collections
 * serving it: for each number, money or percent field, its total and its
 * latest value, and for each collection the count of its records.
 */
export function numberFromChoices(sources: NumberSource[]): NumberFromChoice[] {
  const choices: NumberFromChoice[] = [];
  for (const source of sources) {
    for (const field of source.fields) {
      if (field.removed || !NUMBER_TYPES.has(field.type)) continue;
      const label = field.label.toLowerCase();
      for (const how of ['sum', 'latest'] as const) {
        const from = { collectionId: source.id, field: field.key, how };
        choices.push({
          value: numberFromValue(from),
          label: `${how === 'sum' ? 'Total' : 'Latest'} ${label} of ${source.name}`,
          from,
          unit: unitFor(field),
        });
      }
    }
    const count = { collectionId: source.id, field: null, how: 'count' as const };
    choices.push({
      value: numberFromValue(count),
      label: `Number of ${source.name}`,
      from: count,
      unit: source.name.toLowerCase().slice(0, UNIT_MAX),
    });
  }
  return choices;
}

/**
 * The picker's value: one of the choices, or empty for a number typed in by
 * hand. Anything else is refused rather than guessed at.
 */
export function parseNumberFrom(
  raw: unknown,
  choices: NumberFromChoice[],
): Parsed<NumberFromChoice | null> {
  const value = clean(raw);
  if (!value) return { ok: true, value: null };
  const choice = choices.find((c) => c.value === value);
  if (!choice) return { ok: false, error: 'That collection or field is no longer there.' };
  return { ok: true, value: choice };
}

// ---------------------------------------------------------------------------
// The chart
// ---------------------------------------------------------------------------

export type ChartPoint = { x: number; y: number; reading: Reading };

export type ReadingChart = {
  width: number;
  height: number;
  points: ChartPoint[];
  /** The line through the points, or null for a single reading. */
  path: string | null;
  /** Where the target sits, or null without one. */
  targetY: number | null;
  /** The highest and lowest value drawn, the target included, for the axis labels. */
  high: number;
  low: number;
  /** The plot area inside the chart's padding. */
  plot: { left: number; right: number; top: number; bottom: number };
};

/**
 * Where each reading goes on a chart of the given size. Time runs left to
 * right by date, not by position in the list, so a gap of three months looks
 * like one. The value scale always takes in the target, so the line is read
 * against it, and is padded a little so no point sits on the edge.
 */
export function readingChart(
  readings: Reading[],
  target: number | null,
  { width, height }: { width: number; height: number },
): ReadingChart | null {
  const sorted = sortReadings(readings);
  if (sorted.length === 0) return null;

  const plot = { left: 8, right: width - 8, top: 10, bottom: height - 10 };
  const values = sorted.map((r) => r.value);
  if (target !== null) values.push(target);
  const high = Math.max(...values);
  const low = Math.min(...values);
  let min = low;
  let max = high;
  if (min === max) {
    // One value, or every reading equal to the target: give it room to sit in.
    const spread = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 1;
    min -= spread;
    max += spread;
  } else {
    const pad = (max - min) * 0.08;
    min -= pad;
    max += pad;
  }

  const days = sorted.map((r) => Date.parse(`${r.readOn}T00:00:00Z`) / DAY_MS);
  const firstDay = days[0];
  const span = days[days.length - 1] - firstDay;
  const x = (day: number) =>
    span === 0
      ? (plot.left + plot.right) / 2
      : plot.left + ((day - firstDay) / span) * (plot.right - plot.left);
  const y = (value: number) =>
    plot.bottom - ((value - min) / (max - min)) * (plot.bottom - plot.top);

  // Two readings on one day share an x; the line runs through both in the
  // order they were entered, and the list below the chart shows each.
  const points: ChartPoint[] = sorted.map((reading, index) => ({
    x: x(days[index]),
    y: y(reading.value),
    reading,
  }));

  const path =
    points.length > 1
      ? `M${points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('L')}`
      : null;

  return {
    width,
    height,
    points,
    path,
    targetY: target === null ? null : y(target),
    high,
    low,
    plot,
  };
}

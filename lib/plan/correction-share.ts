/**
 * How often the person's notes correct a screen that was changed recently
 * (plan #1543, docs/UI-QUALITY-SPEC.md Part 7).
 *
 * A screen changes when a step's design check passes for one of its gallery
 * surfaces: a `ui_checks` row with a step and a passing verdict (the critic's
 * `pass` or the person's `accepted`), dated by when it was recorded. A note
 * is a `feedback_items` row. It corrects a changed screen when its page is
 * one of that surface's routes (`SURFACE_ROUTES`), or when it was filed
 * against the surface itself on /dev/surfaces, and the change was recorded in
 * the 30 days up to the note. Nothing links a note to a step, so this is
 * worked out from the routes and the dates every time.
 *
 * Weeks run Monday to Sunday in UTC, the same as Postgres's
 * `date_trunc('week', …)`, so a week can be counted by hand in SQL and come
 * out the same. The first week is the one holding the first change on record:
 * before it no note could count, and a row of zeros there would read as a
 * result rather than as nothing measured.
 *
 * Pure: rows in, weeks out.
 */
import { surfaceOf } from '@/lib/feedback/surfaces';
import { SURFACE_ROUTES } from '@/lib/preview/routes';
import { routePattern } from '@/lib/usage/page-view';
import { PASSING_VERDICTS } from './ui-check-guard';

/** How far back a change still counts as recent when a note is filed. */
export const RECENT_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** As much of a `ui_checks` row as this reads. */
export type ChangeRow = {
  step: number | null;
  surface: string;
  verdict: string;
  created_at: string;
};

/** As much of a `feedback_items` row as this reads. */
export type NoteRow = {
  created_at: string;
  page_path: string | null;
};

/** One week of the measure. */
export type CorrectionWeek = {
  /** The week's Monday, `YYYY-MM-DD`. */
  week: string;
  /** Every note filed that week. */
  notes: number;
  /** Those that correct a screen changed in the 30 days before them. */
  corrections: number;
};

/** The Monday of the UTC week holding an instant, as `YYYY-MM-DD`. */
export function weekOf(at: number): string {
  const day = new Date(at);
  day.setUTCHours(0, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

/**
 * The surfaces a note's page stands for. A note filed on /dev/surfaces names
 * its surface outright; any other page is matched against the surfaces'
 * routes. The page is first resolved to the app's own route pattern the way
 * Next picks one (`routePattern`), so `/goals/files` is the files page and
 * not a goal called "files". A note on a page with no surface stands for
 * none, and never counts.
 */
export function surfacesOfNote(pagePath: string | null): string[] {
  if (!pagePath) return [];
  const named = surfaceOf(pagePath);
  if (named) return [named];
  const route = routePattern(pagePath.split(/[?#]/)[0]);
  if (!route) return [];
  return Object.entries(SURFACE_ROUTES)
    .filter(([, routes]) => routes.some((pattern) => samePattern(pattern, route)))
    .map(([surface]) => surface);
}

/** Two route patterns for one page: the same fixed segments, and a placeholder where the other has one. */
function samePattern(a: string, b: string): boolean {
  const x = a.split('/').filter(Boolean);
  const y = b.split('/').filter(Boolean);
  return (
    x.length === y.length &&
    x.every((part, i) => part === y[i] || (part.startsWith('[') && y[i].startsWith('[')))
  );
}

/**
 * Each week's notes and how many of them correct a recently changed screen,
 * from the week of the first change to the week holding `now`, oldest first.
 * No change on record means nothing to measure, and no weeks.
 */
export function correctionWeeks(
  checks: readonly ChangeRow[],
  notes: readonly NoteRow[],
  now: Date,
  days: number = RECENT_DAYS,
): CorrectionWeek[] {
  const changed = new Map<string, number[]>();
  for (const row of checks) {
    if (row.step === null || !PASSING_VERDICTS.includes(row.verdict)) continue;
    const at = Date.parse(row.created_at);
    if (Number.isNaN(at)) continue;
    const list = changed.get(row.surface);
    if (list) list.push(at);
    else changed.set(row.surface, [at]);
  }
  if (changed.size === 0) return [];

  const first = Math.min(...[...changed.values()].flat());
  const weeks = new Map<string, CorrectionWeek>();
  for (let at = Date.parse(`${weekOf(first)}T00:00:00Z`); at <= now.getTime(); at += 7 * DAY_MS) {
    const week = weekOf(at);
    weeks.set(week, { week, notes: 0, corrections: 0 });
  }

  const window = days * DAY_MS;
  for (const note of notes) {
    const at = Date.parse(note.created_at);
    if (Number.isNaN(at)) continue;
    const week = weeks.get(weekOf(at));
    if (!week) continue;
    week.notes += 1;
    const corrects = surfacesOfNote(note.page_path).some((surface) =>
      (changed.get(surface) ?? []).some((when) => when <= at && when >= at - window),
    );
    if (corrects) week.corrections += 1;
  }
  return [...weeks.values()];
}

/** The week's share as a whole percentage, or null for a week with no notes. */
export function sharePercent(week: CorrectionWeek): number | null {
  return week.notes === 0 ? null : Math.round((week.corrections / week.notes) * 100);
}

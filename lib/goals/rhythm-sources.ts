/**
 * Rhythms that count themselves (docs/GOALS-SPEC.md, "Rhythms";
 * supabase/migrations-goals/0069).
 *
 * A rhythm step can name where its count is read from instead of being
 * counted by hand:
 *
 * - `applications`: job applications sent in the period, by the day their
 *   submitted time falls on in the person's zone.
 * - `calendar`: events on the person's own calendar (typed in Todo or read
 *   from a subscribed feed) whose title matches the rhythm's match text, by
 *   the day they start. An event counts once its day has come, so a booking
 *   for Saturday does not keep the week before Saturday arrives.
 *
 * The match text is one or more pieces of text separated by `|`. An event
 * matches when its title contains any piece, ignoring case: "urbanism|community
 * board" matches "Community Board 6 meeting".
 *
 * The sync (lib/goals/rhythms-store.ts) reads each source once over the days
 * its periods cover and writes what it counts onto those periods; Count one
 * and Take one back are not offered for such a rhythm, and capture does not
 * count towards it.
 *
 * Pure. The reads are in lib/goals/rhythm-sources-store.ts.
 */
import type { PeriodSpan } from '@/lib/goals/rhythms';

export const COUNT_SOURCES = ['applications', 'calendar'] as const;
export type CountSource = (typeof COUNT_SOURCES)[number];

/** The table's limit on the match text (0069). */
export const COUNT_MATCH_MAX = 200;

/** What the rhythm's line says after its count: "2 of 5 this week · from Jobs". */
export const COUNT_SOURCE_LABELS: Record<CountSource, string> = {
  applications: 'Jobs',
  calendar: 'your calendar',
};

/** The choice on the step's form. */
export const COUNT_SOURCE_CHOICES: Record<CountSource, string> = {
  applications: 'Applications sent in Jobs',
  calendar: 'Matching calendar events',
};

/** A rhythm's source as the sync takes it. `match` is set for `calendar` only. */
export type RhythmSource = { kind: CountSource; match: string | null };

export function isCountSource(value: unknown): value is CountSource {
  return typeof value === 'string' && (COUNT_SOURCES as readonly string[]).includes(value);
}

/** A step's source from its two columns, or null when it is counted by hand. */
export function rhythmSource(
  source: string | null | undefined,
  match: string | null | undefined,
): RhythmSource | null {
  if (!isCountSource(source)) return null;
  if (source === 'calendar') {
    const pieces = matchPieces(match);
    return pieces.length > 0 ? { kind: source, match: match as string } : null;
  }
  return { kind: source, match: null };
}

/** The pieces of a match text, trimmed and lowercased, empty ones left out. */
export function matchPieces(match: string | null | undefined): string[] {
  return (match ?? '')
    .split('|')
    .map((piece) => piece.trim().toLowerCase())
    .filter((piece) => piece !== '');
}

/** Whether an event title contains any piece of the match text, ignoring case. */
export function titleMatches(title: string, match: string | null | undefined): boolean {
  const lower = title.toLowerCase();
  return matchPieces(match).some((piece) => lower.includes(piece));
}

/** "2 of 5 this week · from Jobs": the words after the count. */
export function sourceSuffix(source: CountSource | null | undefined): string {
  return source ? ` · from ${COUNT_SOURCE_LABELS[source]}` : '';
}

/** The first and last day a set of periods covers, end excluded; null for none. */
export function spanOf(spans: readonly PeriodSpan[]): PeriodSpan | null {
  if (spans.length === 0) return null;
  let startsOn = spans[0].startsOn;
  let endsOn = spans[0].endsOn;
  for (const span of spans) {
    if (span.startsOn < startsOn) startsOn = span.startsOn;
    if (span.endsOn > endsOn) endsOn = span.endsOn;
  }
  return { startsOn, endsOn };
}

/**
 * How many of `days` (YYYY-MM-DD, one per thing counted) fall in the period,
 * counting none after `today`.
 */
export function countIn(span: PeriodSpan, days: readonly string[], today: string): number {
  let count = 0;
  for (const day of days) {
    if (day >= span.startsOn && day < span.endsOn && day <= today) count += 1;
  }
  return count;
}

/** One calendar event as the store reads it: its title and the day it starts. */
export type SourceEvent = { title: string; day: string };

/** The days of the events a calendar rhythm counts. */
export function calendarDays(events: readonly SourceEvent[], match: string | null): string[] {
  return events.filter((event) => titleMatches(event.title, match)).map((event) => event.day);
}

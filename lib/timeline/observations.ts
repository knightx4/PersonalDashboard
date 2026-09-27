import { eventRef, KIND_NOUNS, kindCount, TIMELINE_KINDS, type TimelineEvent, type TimelineKind, type TimelineModule } from './timeline';

/**
 * The weekly observations (plan #1119): up to three things Dash noticed in
 * the last twelve weeks of the timeline that cross two or more modules, each
 * with a number and the rows behind it.
 *
 * This file is the part with no database and no model: which weeks a run
 * reads, the summary the model is given, and the checks every observation
 * has to pass before it is stored. The model call is observations-model.ts
 * and the run is observations-run.ts.
 */

/** How many whole weeks before the run's week the model reads. */
export const OBSERVATION_WEEKS = 12;

/** The most observations one week keeps. */
export const MAX_OBSERVATIONS = 3;

/** How far back a "not useful" verdict is sent to the next run, in days. */
export const NOT_USEFUL_DAYS = 90;

/** How far back the observations already made are sent, so a week does not repeat the last. */
export const RECENT_WEEKS = 4;

/**
 * The most events listed one by one. Twelve weeks held about 150 to 250 in
 * September 2026; past this the oldest are left out of the list and still
 * counted in the weekly lines.
 */
export const MAX_LISTED_EVENTS = 600;

/** The most rows one observation is asked to cite; the model is told, and nothing is cut. */
export const MAX_EVIDENCE = 40;

/**
 * How alike two sentences' words must be for a new observation to count as a
 * repeat of one marked not useful: the share of their distinct words they
 * have in common.
 */
export const REPEAT_OVERLAP = 0.5;

const DAY_MS = 86_400_000;

/** A date as YYYY-MM-DD in UTC. */
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The week a run on `now` writes for, and the window it reads. Weeks start on
 * Monday at midnight UTC; the run's week is the one `now` falls in, and it
 * reads the twelve whole weeks before it, so a run on Monday afternoon reads
 * up to the Sunday just gone.
 */
export function observationWeek(now: Date): { week: string; from: string; to: string } {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const sinceMonday = (new Date(midnight).getUTCDay() + 6) % 7;
  const monday = midnight - sinceMonday * DAY_MS;
  const from = monday - OBSERVATION_WEEKS * 7 * DAY_MS;
  return {
    week: isoDay(new Date(monday)),
    from: new Date(from).toISOString(),
    to: new Date(monday).toISOString(),
  };
}

/** The Monday of the week an instant falls in, as YYYY-MM-DD. */
export function weekOf(occurredAt: string): string {
  const at = new Date(occurredAt);
  const midnight = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  const sinceMonday = (new Date(midnight).getUTCDay() + 6) % 7;
  return isoDay(new Date(midnight - sinceMonday * DAY_MS));
}

/** Split `schema.table:id` back into its parts; null when it is not one. */
export function parseEventRef(ref: string): { sourceTable: string; sourceId: string } | null {
  const at = ref.indexOf(':');
  if (at <= 0 || at === ref.length - 1) return null;
  const sourceTable = ref.slice(0, at);
  if (!/^[a-z_]+\.[a-z_]+$/.test(sourceTable)) return null;
  return { sourceTable, sourceId: ref.slice(at + 1) };
}

function money(cents: number, currency: string | null): string {
  return `${currency ?? ''} ${(cents / 100).toFixed(2)}`.trim();
}

/** Totals per currency, as "GBP 120.40, USD 12.00", or "none". */
function moneyLine(totals: Map<string, number>): string {
  const parts = [...totals.entries()]
    .filter(([, cents]) => cents !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, cents]) => money(cents, currency || null));
  return parts.length > 0 ? parts.join(', ') : 'none';
}

function addMoney(totals: Map<string, number>, event: TimelineEvent) {
  if (event.amount_cents == null) return;
  const key = event.currency ?? '';
  totals.set(key, (totals.get(key) ?? 0) + event.amount_cents);
}

const KIND_ORDER: TimelineKind[] = Object.values(TIMELINE_KINDS).flat();

function oneLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** What the model is given for one person's twelve weeks, and how to read its citations back. */
export type ObservationInput = {
  /** The text sent as the user turn. */
  summary: string;
  /** The short id each listed event is given in the summary (E1, E2, …) and the event it stands for. */
  events: Map<string, TimelineEvent>;
};

/**
 * The compact summary of a person's timeline the model reads: counts of each
 * kind per week, spend per week and per month, then every event with a short
 * id to cite it by. Short ids rather than the refs themselves, so the model
 * never has to copy a uuid, and a citation that is not one of them is known
 * to be made up.
 */
export function summariseTimeline(
  events: readonly TimelineEvent[],
  window: { week: string; from: string; to: string },
): ObservationInput {
  const sorted = [...events].sort(
    (a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.source_id.localeCompare(b.source_id),
  );

  const weeks: string[] = [];
  for (let at = Date.parse(window.from); at < Date.parse(window.to); at += 7 * DAY_MS) {
    weeks.push(isoDay(new Date(at)));
  }

  const counts = new Map<string, Map<TimelineKind, number>>();
  const spend = new Map<string, Map<string, number>>();
  const refunds = new Map<string, Map<string, number>>();
  const monthSpend = new Map<string, Map<string, number>>();
  for (const event of sorted) {
    const week = weekOf(event.occurred_at);
    const perKind = counts.get(week) ?? new Map<TimelineKind, number>();
    perKind.set(event.kind, (perKind.get(event.kind) ?? 0) + 1);
    counts.set(week, perKind);
    if (event.kind === 'ordered') {
      const weekTotals = spend.get(week) ?? new Map<string, number>();
      addMoney(weekTotals, event);
      spend.set(week, weekTotals);
      const month = event.occurred_at.slice(0, 7);
      const monthTotals = monthSpend.get(month) ?? new Map<string, number>();
      addMoney(monthTotals, event);
      monthSpend.set(month, monthTotals);
    } else if (event.kind === 'returned') {
      const weekTotals = refunds.get(week) ?? new Map<string, number>();
      addMoney(weekTotals, event);
      refunds.set(week, weekTotals);
    }
  }

  const weekLines = weeks.map((week) => {
    const perKind = counts.get(week);
    const done = perKind
      ? KIND_ORDER.filter((kind) => perKind.has(kind))
          .map((kind) => kindCount(kind, perKind.get(kind)!))
          .join(', ')
      : 'nothing recorded';
    const refunded = refunds.get(week);
    return `Week of ${week}: ${done}. Spent: ${moneyLine(spend.get(week) ?? new Map())}.${
      refunded ? ` Refunded: ${moneyLine(refunded)}.` : ''
    }`;
  });

  const firstMonth = window.from.slice(0, 7);
  const monthLines = [...monthSpend.keys()]
    .sort()
    .map(
      (month) =>
        `${month}${month === firstMonth ? ' (from the window start only)' : ''}: ${moneyLine(monthSpend.get(month)!)}`,
    );

  const listed = sorted.slice(-MAX_LISTED_EVENTS);
  const ids = new Map<string, TimelineEvent>();
  const eventLines = listed.map((event, index) => {
    const id = `E${index + 1}`;
    ids.set(id, event);
    const parts = [
      id,
      event.occurred_at.slice(0, 10),
      `${event.module} ${KIND_NOUNS[event.kind]?.one ?? event.kind}`,
      oneLine(event.title, 80),
    ];
    if (event.detail) parts.push(oneLine(event.detail, 60));
    if (event.amount_cents != null) parts.push(money(event.amount_cents, event.currency));
    return parts.join(' | ');
  });

  const left = sorted.length - listed.length;
  const summary = [
    `The twelve weeks from ${window.from.slice(0, 10)} to the week of ${weeks[weeks.length - 1] ?? window.week}. Weeks start on Monday.`,
    '',
    'Each week:',
    ...weekLines,
    '',
    'Spent on orders each month:',
    ...(monthLines.length > 0 ? monthLines : ['No orders in these weeks.']),
    '',
    left > 0
      ? `Every event, oldest first, except the oldest ${left}, which are counted above but not listed:`
      : 'Every event, oldest first:',
    ...(eventLines.length > 0 ? eventLines : ['(none)']),
  ].join('\n');

  return { summary, events: ids };
}

/** One observation as the model gives it, before any check. */
export type RawObservation = { sentence?: unknown; evidence?: unknown };

/** One observation that passed every check, ready to store. */
export type CheckedObservation = {
  sentence: string;
  /** The rows behind it, as eventRef strings, in date order. */
  evidence: string[];
  /** The modules those rows come from, in the timeline's order. */
  modules: TimelineModule[];
};

/** Why an observation was left out; for the run's summary and the tests. */
export type DropReason = 'no-sentence' | 'no-number' | 'unknown-evidence' | 'one-module' | 'repeat' | 'over-limit';

/** A sentence as stored: one line, trimmed, no spaced dashes, capped, ending in a full stop. */
export function cleanSentence(text: string): string {
  const line = text.replace(/\s+/g, ' ').replace(/\s[—–]\s/g, ', ').trim();
  if (!line) return '';
  const capped = line.length > 400 ? `${line.slice(0, 397).trimEnd()}…` : line;
  return /[.?…]$/.test(capped) ? capped : `${capped}.`;
}

const STOPWORDS = new Set([
  'the', 'and', 'you', 'your', 'were', 'was', 'that', 'this', 'with', 'from', 'for', 'than', 'then',
  'when', 'while', 'week', 'weeks', 'after', 'before', 'into', 'out', 'more', 'fewer', 'less', 'had',
  'have', 'has', 'are', 'but', 'each', 'those', 'these', 'same', 'also', 'over', 'last',
]);

function words(sentence: string): Set<string> {
  return new Set(
    sentence
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !STOPWORDS.has(word)),
  );
}

/** The share of their distinct words two sentences have in common, from 0 to 1. */
export function overlap(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

const MODULE_ORDER = Object.keys(TIMELINE_KINDS) as TimelineModule[];

/**
 * Keep what the model gave that can be stored. An observation is dropped
 * when it has no sentence, no number in it, cites an id that was not in the
 * summary, rests on rows from one module only, or says again what one marked
 * not useful said. At most MAX_OBSERVATIONS are kept, in the model's order.
 */
export function checkObservations(
  raw: readonly RawObservation[],
  events: ReadonlyMap<string, TimelineEvent>,
  notUseful: readonly string[],
): { kept: CheckedObservation[]; dropped: DropReason[] } {
  const kept: CheckedObservation[] = [];
  const dropped: DropReason[] = [];

  for (const item of raw) {
    const sentence = typeof item.sentence === 'string' ? cleanSentence(item.sentence) : '';
    if (!sentence) {
      dropped.push('no-sentence');
      continue;
    }
    if (!/\d/.test(sentence)) {
      dropped.push('no-number');
      continue;
    }
    const cited = Array.isArray(item.evidence) ? item.evidence : [];
    const rows = cited.map((id) => (typeof id === 'string' ? events.get(id.trim()) : undefined));
    if (rows.length === 0 || rows.some((row) => !row)) {
      dropped.push('unknown-evidence');
      continue;
    }
    const unique = [...new Map(rows.map((row) => [eventRef(row!), row!])).values()].sort((a, b) =>
      a.occurred_at.localeCompare(b.occurred_at),
    );
    const modules = MODULE_ORDER.filter((module) => unique.some((row) => row.module === module));
    if (modules.length < 2) {
      dropped.push('one-module');
      continue;
    }
    if (notUseful.some((old) => overlap(old, sentence) >= REPEAT_OVERLAP)) {
      dropped.push('repeat');
      continue;
    }
    if (kept.length >= MAX_OBSERVATIONS) {
      dropped.push('over-limit');
      continue;
    }
    kept.push({ sentence, evidence: unique.map(eventRef), modules });
  }
  return { kept, dropped };
}

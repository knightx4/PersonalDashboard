import { formatMoney, type CurrencyCode } from '@/lib/money';
import { monthKeyOf, monthLabel, monthStart, shiftMonth, type MonthKey } from './months';
import {
  eventRef,
  KIND_NOUNS,
  kindCount,
  TIMELINE_KINDS,
  TIMELINE_MODULES,
  type TimelineEvent,
  type TimelineKind,
  type TimelineModule,
} from './timeline';

/**
 * The year in review (plan #1121): what a year held, from the timeline.
 *
 * This file is the part with no database and no model: the year's edges on
 * the person's calendar, the totals the page shows, the summary the model is
 * given, and the checks every paragraph has to pass before it is stored. A
 * paragraph is kept only when every number in it is one the page shows and
 * it names the timeline rows it is about. The model call is
 * year-review-model.ts and the run is year-review-run.ts.
 */

/** Below this many events a year is shown as its totals, with nothing written about it. */
export const MIN_EVENTS_TO_WRITE = 20;

/**
 * The most events listed one by one. 2026 held about 600 by September; past
 * this the oldest are left out of the list and still counted in the totals.
 */
export const MAX_LISTED_YEAR_EVENTS = 1500;

/** How many shops the totals name, by what was spent at them. */
export const TOP_SHOPS = 5;

/** The most rows one paragraph is asked to cite; the model is told, and nothing is cut. */
export const MAX_PARAGRAPH_EVIDENCE = 40;

/** What a paragraph is about, in the order the page shows them. */
export const YEAR_TOPICS = ['shopping', 'jobs', 'learning', 'goals', 'across'] as const;

export type YearTopic = (typeof YEAR_TOPICS)[number];

/** The heading each topic is shown under. */
export const TOPIC_HEADINGS: Record<YearTopic, string> = {
  shopping: 'What you bought',
  jobs: 'The job search',
  learning: 'What you learned and wrote',
  goals: 'Goals and tasks',
  across: 'Across the year',
};

export type Money = { currency: string; cents: number };

export type YearMonth = {
  key: MonthKey;
  events: number;
  /** Events per module, in the timeline's order; none at zero. */
  modules: { module: TimelineModule; count: number }[];
  spent: Money[];
};

/** Every number the year's page shows. Stored with a review so its paragraphs and numbers agree. */
export type YearTotals = {
  year: number;
  events: number;
  /** Counts per kind, in the order TIMELINE_KINDS lists them; none at zero. */
  kinds: { kind: TimelineKind; count: number }[];
  /** Spent on orders, per currency. */
  spent: Money[];
  /** Refunded on returns, per currency. */
  refunded: Money[];
  /** Each month from January to the last one read, empty ones included. */
  months: YearMonth[];
  /** Where the most was spent, at most TOP_SHOPS. */
  shops: { name: string; orders: number; spent: Money[] }[];
  /** The goals that had steps done, most first. `ref` is the goal's id when the timeline has it. */
  goals: { title: string; ref: string | null; steps: number }[];
};

/** One paragraph as stored and shown. */
export type YearParagraph = {
  topic: YearTopic;
  text: string;
  /** The rows behind it, as eventRef strings, oldest first. */
  evidence: string[];
};

const KIND_ORDER: TimelineKind[] = Object.values(TIMELINE_KINDS).flat();

const YEAR = /^\d{4}$/;

/** A year from the URL, or null when it is not one the app could hold. */
export function parseYear(value: string | undefined, current: number): number | null {
  if (!value || !YEAR.test(value)) return null;
  const year = Number(value);
  return year >= 2000 && year <= current ? year : null;
}

/** The year `now` falls in, on the person's calendar. */
export function currentYear(now: Date, timezone: string): number {
  return Number(monthKeyOf(now.toISOString(), timezone).slice(0, 4));
}

/** The instants between which a year's events fall: midnight on 1 January to midnight on the next. */
export function yearWindow(year: number, timezone: string): { from: string; to: string } {
  return { from: monthStart(`${year}-01`, timezone), to: monthStart(`${year + 1}-01`, timezone) };
}

function addMoney(totals: Map<string, number>, event: TimelineEvent) {
  if (event.amount_cents == null) return;
  const key = event.currency ?? 'USD';
  totals.set(key, (totals.get(key) ?? 0) + event.amount_cents);
}

function moneyList(totals: Map<string, number>): Money[] {
  return [...totals.entries()]
    .filter(([, cents]) => cents !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, cents]) => ({ currency, cents }));
}

function total(money: readonly Money[]): number {
  return money.reduce((sum, part) => sum + part.cents, 0);
}

/**
 * Count a year's events. `lastMonth` is the last month the page covers: the
 * current one for the year being lived in, December for one that has ended.
 */
export function yearTotals(
  events: readonly TimelineEvent[],
  year: number,
  timezone: string,
  lastMonth: MonthKey = `${year}-12`,
): YearTotals {
  const kinds = new Map<TimelineKind, number>();
  const spent = new Map<string, number>();
  const refunded = new Map<string, number>();
  const months = new Map<MonthKey, { modules: Map<TimelineModule, number>; spent: Map<string, number>; events: number }>();
  const shops = new Map<string, { orders: number; spent: Map<string, number> }>();
  const goals = new Map<string, { title: string; ref: string | null; steps: number }>();

  for (let key: MonthKey = `${year}-01`; key <= lastMonth; key = shiftMonth(key, 1)) {
    months.set(key, { modules: new Map(), spent: new Map(), events: 0 });
  }

  for (const event of events) {
    kinds.set(event.kind, (kinds.get(event.kind) ?? 0) + 1);
    const month = months.get(monthKeyOf(event.occurred_at, timezone));
    if (month) {
      month.events += 1;
      month.modules.set(event.module, (month.modules.get(event.module) ?? 0) + 1);
    }
    if (event.kind === 'ordered') {
      addMoney(spent, event);
      if (month) addMoney(month.spent, event);
      const shop = shops.get(event.title) ?? { orders: 0, spent: new Map<string, number>() };
      shop.orders += 1;
      addMoney(shop.spent, event);
      shops.set(event.title, shop);
    } else if (event.kind === 'returned') {
      addMoney(refunded, event);
    } else if (event.kind === 'step_done' && event.detail) {
      const key = event.link_ref ?? event.detail;
      const goal = goals.get(key) ?? { title: event.detail, ref: event.link_ref, steps: 0 };
      goal.steps += 1;
      goals.set(key, goal);
    }
  }

  return {
    year,
    events: events.length,
    kinds: KIND_ORDER.filter((kind) => kinds.has(kind)).map((kind) => ({ kind, count: kinds.get(kind)! })),
    spent: moneyList(spent),
    refunded: moneyList(refunded),
    months: [...months.entries()].map(([key, month]) => ({
      key,
      events: month.events,
      modules: TIMELINE_MODULES.filter((module) => month.modules.has(module)).map((module) => ({
        module,
        count: month.modules.get(module)!,
      })),
      spent: moneyList(month.spent),
    })),
    shops: [...shops.entries()]
      .map(([name, shop]) => ({ name, orders: shop.orders, spent: moneyList(shop.spent) }))
      .sort((a, b) => total(b.spent) - total(a.spent) || b.orders - a.orders || a.name.localeCompare(b.name))
      .slice(0, TOP_SHOPS),
    goals: [...goals.values()].sort((a, b) => b.steps - a.steps || a.title.localeCompare(b.title)),
  };
}

/** An amount as the page writes it: "$1,906.41". */
export function moneyText(money: Money): string {
  return formatMoney(money.cents, money.currency as CurrencyCode);
}

/** Several currencies as one line, or "nothing". */
export function moneyLine(money: readonly Money[]): string {
  return money.length > 0 ? money.map(moneyText).join(' and ') : 'nothing';
}

/** Every number in a piece of text, commas taken out: "$1,906.41 on 18 orders" gives 1906.41 and 18. */
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((token) => token.replace(/,/g, '').replace(/\.$/, ''));
}

function addAmount(numbers: Set<string>, cents: number) {
  const whole = Math.abs(cents);
  numbers.add((whole / 100).toFixed(2));
  if (whole % 100 === 0) numbers.add(String(whole / 100));
}

/**
 * The numbers a paragraph may use: the ones the page shows beside it. A
 * paragraph with any other number in it is dropped, which is what keeps a
 * written claim checkable against the totals.
 */
export function shownNumbers(totals: YearTotals): Set<string> {
  const numbers = new Set<string>([String(totals.year), String(totals.events)]);
  for (const { count } of totals.kinds) numbers.add(String(count));
  for (const money of [...totals.spent, ...totals.refunded]) addAmount(numbers, money.cents);
  for (const month of totals.months) {
    numbers.add(String(month.events));
    for (const { count } of month.modules) numbers.add(String(count));
    for (const money of month.spent) addAmount(numbers, money.cents);
  }
  for (const shop of totals.shops) {
    numbers.add(String(shop.orders));
    for (const money of shop.spent) addAmount(numbers, money.cents);
  }
  for (const goal of totals.goals) numbers.add(String(goal.steps));
  return numbers;
}

/** The most characters one paragraph keeps. */
export const MAX_PARAGRAPH_LENGTH = 1200;

/** A paragraph as stored: one line, trimmed, no spaced dashes, capped, ending in a full stop. */
export function cleanParagraph(text: string): string {
  const line = text.replace(/\s+/g, ' ').replace(/\s[—–]\s/g, ', ').trim();
  if (!line) return '';
  const capped =
    line.length > MAX_PARAGRAPH_LENGTH ? `${line.slice(0, MAX_PARAGRAPH_LENGTH - 1).trimEnd()}…` : line;
  return /[.?…]$/.test(capped) ? capped : `${capped}.`;
}

function oneLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** What the model is given for one person's year, and how to read its citations back. */
export type YearInput = {
  summary: string;
  /** The short id each listed event is given (E1, E2, …) and the event it stands for. */
  events: Map<string, TimelineEvent>;
};

/**
 * The summary of a year the model reads: every number the page shows, then
 * every event with a short id to cite it by, as the weekly observations do
 * (observations.ts, summariseTimeline).
 */
export function summariseYear(
  events: readonly TimelineEvent[],
  totals: YearTotals,
  options: { timezone: string; through: string; complete: boolean },
): YearInput {
  const sorted = [...events].sort(
    (a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.source_id.localeCompare(b.source_id),
  );

  const moduleLine = (month: YearMonth) =>
    month.modules.length > 0 ? month.modules.map(({ module, count }) => `${module} ${count}`).join(', ') : 'nothing';

  const listed = sorted.slice(-MAX_LISTED_YEAR_EVENTS);
  const ids = new Map<string, TimelineEvent>();
  const eventLines = listed.map((event, index) => {
    const id = `E${index + 1}`;
    ids.set(id, event);
    const parts = [
      id,
      monthLabel(monthKeyOf(event.occurred_at, options.timezone)),
      `${event.module} ${KIND_NOUNS[event.kind]?.one ?? event.kind}`,
      oneLine(event.title, 80),
    ];
    if (event.detail && event.kind !== 'ordered') parts.push(oneLine(event.detail, 60));
    if (event.amount_cents != null) parts.push(moneyText({ currency: event.currency ?? 'USD', cents: event.amount_cents }));
    return parts.join(' | ');
  });
  const left = sorted.length - listed.length;

  const summary = [
    options.complete
      ? `The whole of ${totals.year}.`
      : `${totals.year} so far: from 1 January to ${options.through.slice(0, 10)}. The year is not over.`,
    '',
    'The numbers the page shows. These are the only numbers you may write.',
    `Events on the timeline: ${totals.events}`,
    `For the year: ${totals.kinds.map(({ kind, count }) => kindCount(kind, count)).join(', ') || 'nothing'}`,
    `Spent on orders: ${moneyLine(totals.spent)}`,
    `Refunded on returns: ${moneyLine(totals.refunded)}`,
    '',
    'Each month (events, then events per workspace, then spent on orders):',
    ...totals.months.map(
      (month) => `${monthLabel(month.key)}: ${month.events} events (${moduleLine(month)}). Spent: ${moneyLine(month.spent)}.`,
    ),
    '',
    'Where the most was spent:',
    ...(totals.shops.length > 0
      ? totals.shops.map((shop) => `${shop.name}: ${shop.orders} ${shop.orders === 1 ? 'order' : 'orders'}, ${moneyLine(shop.spent)}`)
      : ['(no orders)']),
    '',
    'Goals with steps done:',
    ...(totals.goals.length > 0
      ? totals.goals.map((goal) => `${goal.title}: ${goal.steps} ${goal.steps === 1 ? 'step' : 'steps'}`)
      : ['(none)']),
    '',
    left > 0
      ? `Every event, oldest first, except the oldest ${left}, which are counted above but not listed:`
      : 'Every event, oldest first:',
    ...(eventLines.length > 0 ? eventLines : ['(none)']),
  ].join('\n');

  return { summary, events: ids };
}

/** One paragraph as the model gives it, before any check. */
export type RawParagraph = { topic?: unknown; text?: unknown; evidence?: unknown };

/** Why a paragraph was left out; for the run's result and the tests. */
export type ParagraphDropReason =
  | 'no-topic'
  | 'repeat-topic'
  | 'no-text'
  | 'no-number'
  | 'unshown-number'
  | 'unknown-evidence';

function isTopic(value: unknown): value is YearTopic {
  return typeof value === 'string' && (YEAR_TOPICS as readonly string[]).includes(value);
}

/**
 * Keep what the model wrote that can be stored. A paragraph is dropped when
 * its topic is not one of YEAR_TOPICS or repeats one already kept, when it
 * has no number, when any number in it is not one the page shows, or when it
 * cites no rows or an id that was not in the summary. What is kept is in the
 * page's order of topics.
 */
export function checkParagraphs(
  raw: readonly RawParagraph[],
  events: ReadonlyMap<string, TimelineEvent>,
  numbers: ReadonlySet<string>,
): { kept: YearParagraph[]; dropped: ParagraphDropReason[] } {
  const kept = new Map<YearTopic, YearParagraph>();
  const dropped: ParagraphDropReason[] = [];

  for (const item of raw) {
    if (!isTopic(item.topic)) {
      dropped.push('no-topic');
      continue;
    }
    if (kept.has(item.topic)) {
      dropped.push('repeat-topic');
      continue;
    }
    const text = typeof item.text === 'string' ? cleanParagraph(item.text) : '';
    if (!text) {
      dropped.push('no-text');
      continue;
    }
    const found = numbersIn(text);
    if (found.length === 0) {
      dropped.push('no-number');
      continue;
    }
    if (found.some((number) => !numbers.has(number))) {
      dropped.push('unshown-number');
      continue;
    }
    const cited = Array.isArray(item.evidence) ? item.evidence : [];
    const rows = cited.map((id) => (typeof id === 'string' ? events.get(id.trim()) : undefined));
    if (rows.length === 0 || rows.some((row) => !row)) {
      dropped.push('unknown-evidence');
      continue;
    }
    const unique = [...new Map(rows.map((row) => [eventRef(row!), row!])).values()].sort(
      (a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.source_id.localeCompare(b.source_id),
    );
    kept.set(item.topic, { topic: item.topic, text, evidence: unique.map(eventRef) });
  }

  return { kept: YEAR_TOPICS.filter((topic) => kept.has(topic)).map((topic) => kept.get(topic)!), dropped };
}

/** One row of core.year_reviews, as the page reads it. */
export type YearReviewRecord = {
  year: number;
  through: string;
  complete: boolean;
  events: number;
  totals: YearTotals;
  paragraphs: YearParagraph[];
  model: string | null;
  written_at: string;
};

/** The columns read from core.year_reviews. */
export const YEAR_REVIEW_COLUMNS = 'year, through, complete, events, totals, paragraphs, model, written_at';

/**
 * Whether a review may be written now: never for a year still to come, and
 * never again once one was written after its year ended.
 */
export function canWriteReview(
  year: number,
  current: number,
  stored: Pick<YearReviewRecord, 'complete'> | null,
): boolean {
  return year <= current && !stored?.complete;
}

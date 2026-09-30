import type { ModuleId } from '@/lib/modules';
import { eventRef, type TimelineEvent } from '@/lib/timeline/timeline';
import { addDays } from '@/lib/todo/tasks/model';
import { wallClockToInstant } from '@/lib/todo/time';

/**
 * The weekly review's numbers (plan #1231): what a week held across the
 * modules, each figure beside last week's and the goals it bears on.
 *
 * The app counts and Dash only chooses and words (#1232), so every number on
 * the Week page can be checked against the rows named in its evidence. Pure:
 * it takes the rows and the week, never the clock or the database, so a week
 * is tested with rows written by hand. The reads are in ./load.ts.
 *
 * A week runs from Sunday midnight to the next Sunday midnight in the
 * review's zone (America/New_York unless told otherwise), so a week that
 * crosses a clock change is 167 or 169 hours long and still starts and ends
 * at local midnight.
 *
 * What is counted, and from where:
 *
 * - Jobs, from core.timeline: applications sent; replies received, meaning
 *   rejections and offers; interviews held.
 * - Events you went to, from goals.suggestions: events marked going, unless
 *   later marked as not attended. The app knows no other attendance.
 * - Shopping and money: orders placed (core.timeline); spend per currency,
 *   which is orders plus recurring charges taken (public.recurring_charges,
 *   event 'charge'); refunds per currency, from returns (core.timeline); bills
 *   that arrived and price rises, from public.recurring_charges. The app
 *   records no income, so refunds are the only money in. A bill is a
 *   statement of what is owed, often a card that the orders were already paid
 *   on, so it is counted but not added to spend.
 * - Learn: readings finished, and checks answered (probe, placement and quiz
 *   answers together).
 * - Vault: notes written. Todo: tasks done.
 * - Goals: steps closed, goals reached, and the goals whose latest review at
 *   the week's end says stalled, by name.
 */

export const WEEK_REVIEW_ZONE = 'America/New_York';

/** Where a fact's number comes from. Money is shown under Shopping, as the rest of the app does. */
export type WeekFactModule = Extract<ModuleId, 'jobs' | 'shopping' | 'learn' | 'vault' | 'todo' | 'goals'>;

export type WeekFact = {
  /** Stable across weeks, so last week's figure is found by it: 'jobs.applied', 'money.spent.USD'. */
  id: string;
  module: WeekFactModule;
  /** What the number counts, as a phrase: "applications sent", "spent in USD". */
  label: string;
  /** This week's figure: a count, or cents when currency is set. */
  value: number;
  /** Last week's figure, in the same unit. */
  previous: number;
  /** Set for money: value and previous are in minor units of it. */
  currency: string | null;
  /** The open goals this number bears on, as goals.items ids. */
  goalIds: string[];
  /** This week's rows behind the figure, as `schema.table:id`. */
  evidence: string[];
};

export type StalledGoal = {
  goalId: string;
  title: string;
  /** The review's reason, as the goals run wrote it. */
  reason: string;
  /** Whether its latest review at the end of last week also said stalled. */
  stalledLastWeek: boolean;
  /** The goals.reviews row, as `goals.reviews:id`. */
  evidence: string;
};

/** One week's numbers, as core.week_reviews.facts stores them. */
export type WeekFacts = {
  /** The Sunday that starts the week, YYYY-MM-DD. */
  week: string;
  timezone: string;
  /** The week's edges as instants: from is inclusive, to exclusive. */
  from: string;
  to: string;
  /**
   * Where last week's figures came from: 'review' when last week's stored
   * review supplied them, 'counted' when they were counted fresh from rows.
   */
  previousFrom: 'review' | 'counted';
  facts: WeekFact[];
  stalled: StalledGoal[];
  /** Every open goal, so an observation can be tied to one the numbers do not name. */
  goals: { id: string; title: string }[];
};

// The rows the facts are counted from ----------------------------------------

/** goals.items, the goals and the steps beneath them. */
export type GoalItemRow = {
  id: string;
  parent_id: string | null;
  level: string;
  status: string;
  title: string;
};

/** goals.links: a goal that holds the job search, a role, an application or a Learn aim. */
export type GoalLinkRow = { item_id: string; kind: string };

/** goals.reviews, the goals run's verdict on a goal. */
export type GoalReviewRow = {
  id: string;
  item_id: string;
  verdict: string;
  reason: string;
  created_at: string;
};

/** goals.suggestions of kind 'events'. */
export type SuggestionRow = {
  id: string;
  item_id: string | null;
  title: string;
  happens_on: string | null;
  starts_at: string | null;
  reaction: string | null;
  attended: boolean | null;
};

/** public.recurring_charges. */
export type ChargeRow = {
  id: string;
  event: string;
  amount_cents: number | null;
  previous_amount_cents: number | null;
  currency: string;
  occurred_on: string;
};

export type WeekRows = {
  /** core.timeline rows covering both weeks. */
  timeline: readonly TimelineEvent[];
  suggestions: readonly SuggestionRow[];
  charges: readonly ChargeRow[];
  items: readonly GoalItemRow[];
  links: readonly GoalLinkRow[];
  /** Every review of the person's goals up to the week's end. */
  reviews: readonly GoalReviewRow[];
};

// The week ---------------------------------------------------------------------

function isDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function dayOfWeek(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** The week's edges: local midnight on its Sunday to local midnight a week later. */
export function weekBounds(week: string, timezone: string = WEEK_REVIEW_ZONE): { from: string; to: string } {
  if (!isDay(week) || dayOfWeek(week) !== 0) throw new Error(`A review week starts on a Sunday, not ${week}.`);
  return {
    from: wallClockToInstant(week, '00:00', timezone),
    to: wallClockToInstant(addDays(week, 7), '00:00', timezone),
  };
}

/** The local calendar day of an instant, YYYY-MM-DD. */
export function localDay(at: Date, timezone: string = WEEK_REVIEW_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/**
 * The last whole week before `now`: the Sunday that starts it. On a Sunday
 * that is the week that ended at midnight, which is the one the Sunday
 * review is about.
 */
export function weekJustGone(now: Date, timezone: string = WEEK_REVIEW_ZONE): string {
  const today = localDay(now, timezone);
  return addDays(today, -dayOfWeek(today) - 7);
}

// Counting ---------------------------------------------------------------------

type Counted = Omit<WeekFact, 'previous'>;

type Window = { week: string; from: number; to: number; endDay: string };

function windowOf(week: string, timezone: string): Window {
  const { from, to } = weekBounds(week, timezone);
  return { week, from: Date.parse(from), to: Date.parse(to), endDay: addDays(week, 7) };
}

function inWindow(at: string, window: Window): boolean {
  const time = Date.parse(at);
  return time >= window.from && time < window.to;
}

function dayInWindow(day: string, window: Window): boolean {
  return day >= window.week && day < window.endDay;
}

/** Goal ids by item: a goal is its own, a step is the goal it sits under however deep. */
function goalOfItems(items: readonly GoalItemRow[]): Map<string, string> {
  const byId = new Map(items.map((item) => [item.id, item]));
  const goalOf = new Map<string, string>();
  for (const item of items) {
    let at: GoalItemRow | undefined = item;
    for (let depth = 0; at && depth < 50; depth += 1) {
      if (at.level === 'goal') {
        goalOf.set(item.id, at.id);
        break;
      }
      at = at.parent_id ? byId.get(at.parent_id) : undefined;
    }
  }
  return goalOf;
}

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/** Stalled goals at a week's end: open goals whose latest review before it says stalled. */
function stalledAt(
  rows: WeekRows,
  openGoals: Map<string, string>,
  end: number,
): Map<string, GoalReviewRow> {
  const latest = new Map<string, GoalReviewRow>();
  for (const review of rows.reviews) {
    if (!openGoals.has(review.item_id) || Date.parse(review.created_at) >= end) continue;
    const seen = latest.get(review.item_id);
    if (!seen || Date.parse(review.created_at) > Date.parse(seen.created_at)) latest.set(review.item_id, review);
  }
  return new Map([...latest].filter(([, review]) => review.verdict === 'stalled'));
}

const TIMELINE_COUNTS: {
  id: string;
  module: WeekFactModule;
  label: string;
  kinds: readonly string[];
  linkedBy?: 'jobs' | 'learn';
}[] = [
  { id: 'jobs.applied', module: 'jobs', label: 'applications sent', kinds: ['applied'], linkedBy: 'jobs' },
  { id: 'jobs.replies', module: 'jobs', label: 'replies received (rejections and offers)', kinds: ['rejected', 'offer'], linkedBy: 'jobs' },
  { id: 'jobs.interviews', module: 'jobs', label: 'interviews held', kinds: ['interviewed'], linkedBy: 'jobs' },
  { id: 'shopping.orders', module: 'shopping', label: 'orders placed', kinds: ['ordered'] },
  { id: 'learn.readings', module: 'learn', label: 'readings finished', kinds: ['reading_finished'], linkedBy: 'learn' },
  {
    id: 'learn.checks',
    module: 'learn',
    label: 'checks answered',
    kinds: ['probe_answered', 'placement_answered', 'quiz_answered'],
    linkedBy: 'learn',
  },
  { id: 'vault.notes', module: 'vault', label: 'notes written', kinds: ['note_written'] },
  { id: 'todo.tasks', module: 'todo', label: 'tasks done', kinds: ['task_done'] },
];

const LINK_MODULE: Record<string, 'jobs' | 'learn'> = {
  job_search: 'jobs',
  role: 'jobs',
  application: 'jobs',
  aim: 'learn',
};

/** The order facts are listed in: the modules in the feature's order, money in the middle. */
export const FACT_ORDER = [
  'jobs.applied',
  'jobs.replies',
  'jobs.interviews',
  'events.attended',
  'shopping.orders',
  'money.spent',
  'money.refunded',
  'money.bills',
  'money.rises',
  'learn.readings',
  'learn.checks',
  'vault.notes',
  'todo.tasks',
  'goals.steps',
  'goals.reached',
  'goals.stalled',
];

function orderOf(id: string): number {
  const at = FACT_ORDER.findIndex((prefix) => id === prefix || id.startsWith(`${prefix}.`));
  return at === -1 ? FACT_ORDER.length : at;
}

type Context = {
  goalOf: Map<string, string>;
  openGoals: Map<string, string>;
  linked: Record<'jobs' | 'learn', string[]>;
};

function countWeek(rows: WeekRows, window: Window, context: Context): Map<string, Counted> {
  const counted = new Map<string, Counted>();
  const open = (ids: Iterable<string>) => unique([...ids].filter((id) => context.openGoals.has(id)));
  const put = (fact: Counted) => counted.set(fact.id, fact);

  const events = rows.timeline.filter((event) => inWindow(event.occurred_at, window));

  for (const spec of TIMELINE_COUNTS) {
    const matched = events.filter((event) => spec.kinds.includes(event.kind));
    put({
      id: spec.id,
      module: spec.module,
      label: spec.label,
      value: matched.length,
      currency: null,
      goalIds: spec.linkedBy ? context.linked[spec.linkedBy] : [],
      evidence: matched.map(eventRef),
    });
  }

  // Goal steps and goals closed carry their goal in link_ref.
  for (const [id, kind, label] of [
    ['goals.steps', 'step_done', 'goal steps closed'],
    ['goals.reached', 'goal_done', 'goals reached'],
  ] as const) {
    const matched = events.filter((event) => event.kind === kind);
    put({
      id,
      module: 'goals',
      label,
      value: matched.length,
      currency: null,
      goalIds: open(matched.flatMap((event) => (event.link_ref ? [event.link_ref] : []))),
      evidence: matched.map(eventRef),
    });
  }

  // Events you went to: marked going, and not later marked as missed.
  const attended = rows.suggestions.filter((row) => {
    if (row.reaction !== 'going' && row.attended !== true) return false;
    if (row.attended === false) return false;
    if (row.starts_at) return inWindow(row.starts_at, window);
    return row.happens_on ? dayInWindow(row.happens_on, window) : false;
  });
  put({
    id: 'events.attended',
    module: 'goals',
    label: 'events you went to',
    value: attended.length,
    currency: null,
    goalIds: open(attended.flatMap((row) => {
      const goal = row.item_id ? context.goalOf.get(row.item_id) : undefined;
      return goal ? [goal] : [];
    })),
    evidence: attended.map((row) => `goals.suggestions:${row.id}`),
  });

  // Money, per currency.
  const money = (kind: 'spent' | 'refunded', currency: string, cents: number, ref: string) => {
    const id = `money.${kind}.${currency}`;
    const fact = counted.get(id) ?? {
      id,
      module: 'shopping' as const,
      label: `${kind} in ${currency}`,
      value: 0,
      currency,
      goalIds: [],
      evidence: [],
    };
    fact.value += cents;
    fact.evidence.push(ref);
    counted.set(id, fact);
  };
  for (const event of events) {
    if (event.amount_cents == null) continue;
    if (event.kind === 'ordered') money('spent', event.currency ?? 'unknown', event.amount_cents, eventRef(event));
    if (event.kind === 'returned') money('refunded', event.currency ?? 'unknown', event.amount_cents, eventRef(event));
  }
  const charges = rows.charges.filter((row) => dayInWindow(row.occurred_on, window));
  for (const row of charges) {
    if (row.event === 'charge' && row.amount_cents != null) {
      money('spent', row.currency, row.amount_cents, `public.recurring_charges:${row.id}`);
    }
  }

  const bills = charges.filter((row) => row.event === 'bill');
  put({
    id: 'money.bills',
    module: 'shopping',
    label: 'bills that arrived',
    value: bills.length,
    currency: null,
    goalIds: [],
    evidence: bills.map((row) => `public.recurring_charges:${row.id}`),
  });
  const rises = charges.filter(
    (row) =>
      row.event === 'price_change' &&
      !(row.amount_cents != null && row.previous_amount_cents != null && row.amount_cents <= row.previous_amount_cents),
  );
  put({
    id: 'money.rises',
    module: 'shopping',
    label: 'price rises',
    value: rises.length,
    currency: null,
    goalIds: [],
    evidence: rises.map((row) => `public.recurring_charges:${row.id}`),
  });

  const stalled = stalledAt(rows, context.openGoals, window.to);
  put({
    id: 'goals.stalled',
    module: 'goals',
    label: 'goals stalled',
    value: stalled.size,
    currency: null,
    goalIds: unique(stalled.keys()),
    evidence: [...stalled.values()].map((review) => `goals.reviews:${review.id}`),
  });

  return counted;
}

/** Last week's figures from its stored review, by fact id; null when the stored facts are not usable. */
function storedFigures(stored: unknown, week: string): { figures: Map<string, number>; stalled: Set<string> } | null {
  if (!stored || typeof stored !== 'object') return null;
  const facts = (stored as { facts?: unknown }).facts;
  if ((stored as { week?: unknown }).week !== week || !Array.isArray(facts)) return null;
  const figures = new Map<string, number>();
  for (const fact of facts) {
    const { id, value } = (fact ?? {}) as { id?: unknown; value?: unknown };
    if (typeof id === 'string' && typeof value === 'number' && Number.isFinite(value)) figures.set(id, value);
  }
  const stalled = new Set<string>();
  const stalledRows = (stored as { stalled?: unknown }).stalled;
  if (Array.isArray(stalledRows)) {
    for (const row of stalledRows) {
      const { goalId } = (row ?? {}) as { goalId?: unknown };
      if (typeof goalId === 'string') stalled.add(goalId);
    }
  }
  return { figures, stalled };
}

/**
 * The week's facts. `rows` covers this week and the one before; `previous` is
 * last week's stored review facts (core.week_reviews.facts), whose figures
 * are used where it has them, so the comparison is with what was counted
 * then. Without it, or for a fact it does not hold, last week is counted
 * fresh from the same rows.
 *
 * Every non-money fact is always listed, at zero on a quiet week. A money
 * fact is listed for each currency either week spent or was refunded in.
 */
export function weekFacts(
  week: string,
  rows: WeekRows,
  options: { timezone?: string; previous?: unknown } = {},
): WeekFacts {
  const timezone = options.timezone ?? WEEK_REVIEW_ZONE;
  const bounds = weekBounds(week, timezone);
  const lastWeek = addDays(week, -7);

  const goalOf = goalOfItems(rows.items);
  const openGoals = new Map(
    rows.items.filter((item) => item.level === 'goal' && item.status === 'open').map((item) => [item.id, item.title]),
  );
  const linked: Context['linked'] = { jobs: [], learn: [] };
  for (const link of rows.links) {
    const linkedModule = LINK_MODULE[link.kind];
    const goal = goalOf.get(link.item_id);
    if (linkedModule && goal && openGoals.has(goal)) linked[linkedModule].push(goal);
  }
  const context: Context = { goalOf, openGoals, linked: { jobs: unique(linked.jobs), learn: unique(linked.learn) } };

  const now = countWeek(rows, windowOf(week, timezone), context);
  const before = countWeek(rows, windowOf(lastWeek, timezone), context);
  const stored = storedFigures(options.previous, lastWeek);

  const ids = new Set([...now.keys(), ...before.keys(), ...(stored?.figures.keys() ?? [])]);
  const facts: WeekFact[] = [];
  for (const id of ids) {
    const shape = now.get(id) ?? before.get(id);
    if (!shape) continue; // a fact only the stored review knows, from an older version of this list
    const current = now.get(id);
    facts.push({
      id,
      module: shape.module,
      label: shape.label,
      value: current?.value ?? 0,
      previous: stored?.figures.get(id) ?? before.get(id)?.value ?? 0,
      currency: shape.currency,
      goalIds: current?.goalIds ?? (shape.currency ? [] : shape.goalIds),
      evidence: current?.evidence ?? [],
    });
  }
  facts.sort((a, b) => orderOf(a.id) - orderOf(b.id) || a.id.localeCompare(b.id));

  const end = Date.parse(bounds.to);
  const stalledNow = stalledAt(rows, openGoals, end);
  const stalledBefore = stored
    ? stored.stalled
    : new Set(stalledAt(rows, openGoals, Date.parse(weekBounds(lastWeek, timezone).to)).keys());
  const stalled: StalledGoal[] = [...stalledNow.values()]
    .map((review) => ({
      goalId: review.item_id,
      title: openGoals.get(review.item_id) ?? '',
      reason: review.reason,
      stalledLastWeek: stalledBefore.has(review.item_id),
      evidence: `goals.reviews:${review.id}`,
    }))
    .sort((a, b) => a.title.localeCompare(b.title));

  return {
    week,
    timezone,
    from: bounds.from,
    to: bounds.to,
    previousFrom: stored ? 'review' : 'counted',
    facts,
    stalled,
    goals: [...openGoals].map(([id, title]) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title)),
  };
}

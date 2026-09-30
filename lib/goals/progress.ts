/**
 * Progress entries: partial progress on a step or goal (plan #1274).
 *
 * A sentence such as "moved two bags to the office" counts towards the step
 * it belongs to without closing it. Each one is a dated row in
 * goals.progress_entries with the person's words, and a quantity and unit
 * when the sentence gave a number, or a rough estimate of how far along when
 * it did not. Undo marks the row with `undone_at` rather than deleting it.
 * A step may also carry the total its entries count towards
 * (goals.items.estimated_total and total_unit).
 *
 * This file holds the types and rules; the reads and writes are in
 * lib/goals/progress-store.ts.
 */

import { formatDay } from '@/lib/goals/dates';

/** The limits the table's checks set (supabase/migrations-goals/0063). */
export const PROGRESS_TEXT_MAX = 2000;
export const PROGRESS_UNIT_MAX = 40;

/** How far along, as a rough answer when no total is known. */
export const PROGRESS_ESTIMATES = ['started', 'half', 'nearly'] as const;
export type ProgressEstimate = (typeof PROGRESS_ESTIMATES)[number];

export type ProgressEntry = {
  id: string;
  /** The step or goal the entry sits on. */
  itemId: string;
  /** Set when the entry came from the capture box. */
  captureId: string | null;
  /** YYYY-MM-DD. */
  happenedOn: string;
  text: string;
  quantity: number | null;
  unit: string | null;
  estimate: ProgressEstimate | null;
  /** ISO timestamp. */
  createdAt: string;
};

/** What a writer hands the store: an entry before it has a row. */
export type NewProgressEntry = {
  itemId: string;
  text: string;
  /** YYYY-MM-DD; the database uses today when it is left out. */
  happenedOn?: string | null;
  quantity?: number | null;
  unit?: string | null;
  estimate?: ProgressEstimate | null;
  captureId?: string | null;
};

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function isProgressEstimate(value: unknown): value is ProgressEstimate {
  return typeof value === 'string' && (PROGRESS_ESTIMATES as readonly string[]).includes(value);
}

/**
 * Check an entry against the table's rules before it is written, so a model's
 * odd answer is turned away with a reason instead of a constraint error. The
 * text and unit come back trimmed; an empty unit is no unit.
 */
export function checkProgressEntry(entry: NewProgressEntry): Parsed<NewProgressEntry> {
  const text = entry.text.trim();
  if (text === '') return { ok: false, error: 'Say what happened.' };
  if (text.length > PROGRESS_TEXT_MAX) {
    return { ok: false, error: `Keep it under ${PROGRESS_TEXT_MAX} characters.` };
  }

  const quantity = entry.quantity ?? null;
  if (quantity !== null && !(Number.isFinite(quantity) && quantity > 0)) {
    return { ok: false, error: 'An amount has to be more than nothing.' };
  }

  const unit = entry.unit?.trim() || null;
  if (unit !== null && quantity === null) {
    return { ok: false, error: 'A unit needs an amount to go with it.' };
  }
  if (unit !== null && unit.length > PROGRESS_UNIT_MAX) {
    return { ok: false, error: `Keep the unit under ${PROGRESS_UNIT_MAX} characters.` };
  }

  const estimate = entry.estimate ?? null;
  if (estimate !== null && !isProgressEstimate(estimate)) {
    return { ok: false, error: 'How far along is started, half or nearly.' };
  }

  const happenedOn = entry.happenedOn ?? null;
  if (happenedOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(happenedOn)) {
    return { ok: false, error: 'The day has to be a date.' };
  }

  return {
    ok: true,
    value: {
      itemId: entry.itemId,
      text,
      happenedOn,
      quantity,
      unit,
      estimate,
      captureId: entry.captureId ?? null,
    },
  };
}

/** Newest first: by the day it happened, then by when it was written. */
export function sortProgressEntries(entries: readonly ProgressEntry[]): ProgressEntry[] {
  return [...entries].sort(
    (a, b) =>
      b.happenedOn.localeCompare(a.happenedOn) || b.createdAt.localeCompare(a.createdAt),
  );
}

/**
 * The running tally of entries in one unit: the sum of their quantities.
 * Units are matched ignoring case and surrounding space, and a unit of null
 * sums the entries that gave an amount with no unit. Entries with no amount
 * add nothing.
 */
export function tallyProgress(entries: readonly ProgressEntry[], unit: string | null): number {
  const want = unit?.trim().toLowerCase() || null;
  return entries.reduce((sum, entry) => {
    if (entry.quantity === null) return sum;
    const has = entry.unit?.trim().toLowerCase() || null;
    return has === want ? sum + entry.quantity : sum;
  }, 0);
}

/** One unit's running total, spelt as the newest entry in that unit spelt it. */
export type ProgressTally = { quantity: number; unit: string | null };

/**
 * What a step's or goal's entries add up to (plan #1276), derived rather than
 * stored: nothing in goals.items says a step is under way.
 */
export type ProgressSummary = {
  /** The entries on this item itself, newest first. */
  entries: ProgressEntry[];
  count: number;
  /** One per unit, the unit with the most recent entry first. */
  tallies: ProgressTally[];
  /** The newest day logged on this item itself. */
  lastOn: string | null;
  /** The newest day logged on this item or anything beneath it. */
  latestOn: string | null;
  /** Entries on it and it is still open: not done or dropped. */
  underWay: boolean;
};

/** A node of the tree the summaries roll up through: a step, or a goal. */
export type ProgressTreeNode = {
  id: string;
  status?: string;
  children: readonly ProgressTreeNode[];
};

const unitKey = (unit: string | null) => unit?.trim().toLowerCase() || '';

/** The running total per unit of some entries, newest unit first. */
export function progressTallies(entries: readonly ProgressEntry[]): ProgressTally[] {
  const byUnit = new Map<string, ProgressTally>();
  for (const entry of sortProgressEntries(entries)) {
    if (entry.quantity === null) continue;
    const key = unitKey(entry.unit);
    const tally = byUnit.get(key);
    if (tally) tally.quantity += entry.quantity;
    else byUnit.set(key, { quantity: entry.quantity, unit: entry.unit?.trim() || null });
  }
  // Floating sums print as 0.30000000000000004 otherwise.
  return [...byUnit.values()].map((tally) => ({
    ...tally,
    quantity: Math.round(tally.quantity * 1000) / 1000,
  }));
}

const later = (a: string | null, b: string | null) => (a === null ? b : b === null || a >= b ? a : b);

/**
 * Each item's summary, by item id, for the items that have entries and for
 * every node of `trees` with entries beneath it. A node's `latestOn` counts
 * its descendants' entries too, so a parent step and the goal can say when
 * anything under them was last logged. Items with no entries on them or
 * beneath them are left out, so a step with none looks as it always has.
 */
export function summariseProgress(
  entries: readonly ProgressEntry[],
  trees: readonly ProgressTreeNode[] = [],
): Record<string, ProgressSummary> {
  const byItem = new Map<string, ProgressEntry[]>();
  for (const entry of entries) {
    const list = byItem.get(entry.itemId);
    if (list) list.push(entry);
    else byItem.set(entry.itemId, [entry]);
  }

  const out: Record<string, ProgressSummary> = {};
  const summaryOf = (id: string, status?: string): ProgressSummary => {
    const own = sortProgressEntries(byItem.get(id) ?? []);
    const lastOn = own[0]?.happenedOn ?? null;
    return {
      entries: own,
      count: own.length,
      tallies: progressTallies(own),
      lastOn,
      latestOn: lastOn,
      underWay: own.length > 0 && status !== 'done' && status !== 'dropped',
    };
  };
  for (const id of byItem.keys()) out[id] = summaryOf(id);

  const walk = (node: ProgressTreeNode): string | null => {
    let latest = out[node.id]?.lastOn ?? null;
    for (const child of node.children) latest = later(latest, walk(child));
    if (latest !== null) out[node.id] = { ...summaryOf(node.id, node.status), latestOn: latest };
    return latest;
  };
  for (const tree of trees) walk(tree);
  return out;
}

/** "7", "2.5": a quantity as a person writes it. */
function amount(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : String(Number(quantity.toFixed(2)));
}

/** "7 bags", or "7" when no unit was given. */
export function tallyText(tally: ProgressTally): string {
  return tally.unit ? `${amount(tally.quantity)} ${tally.unit}` : amount(tally.quantity);
}

/** "7 bags so far", "7 bags and 2 boxes so far"; null when nothing was counted. */
export function tallyLine(tallies: readonly ProgressTally[]): string | null {
  if (tallies.length === 0) return null;
  const parts = tallies.map(tallyText);
  const joined =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${joined} so far`;
}

const ESTIMATE_WORDS: Record<ProgressEstimate, string> = {
  started: 'Started',
  half: 'About half done',
  nearly: 'Nearly done',
};

/** What one entry counted: "2 bags", "About half done", or null for neither. */
export function entryAmount(entry: ProgressEntry): string | null {
  if (entry.quantity !== null) return tallyText({ quantity: entry.quantity, unit: entry.unit });
  return entry.estimate ? ESTIMATE_WORDS[entry.estimate] : null;
}

/**
 * A logged day against today: "today", "yesterday", "3 days ago" within the
 * week, and the date ("12 Sep") after that. Both are YYYY-MM-DD.
 */
export function loggedWhen(day: string, today: string): string {
  const days = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000,
  );
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return formatDay(day, day.slice(0, 4) !== today.slice(0, 4));
}

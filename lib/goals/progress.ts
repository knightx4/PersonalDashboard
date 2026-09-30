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

/**
 * One unit's running tally on a step (plan #1276): the summed quantity and
 * the unit as the newest entry spelled it. A unit of null sums the entries
 * that gave an amount with no unit.
 */
export type ProgressTally = { quantity: number; unit: string | null };

/** What the goal page shows for one step or goal with entries on it. */
export type ItemProgress = {
  /** Newest first. */
  entries: ProgressEntry[];
  /** One per unit, in the order the units were last used, newest first. */
  tallies: ProgressTally[];
  /** YYYY-MM-DD: the day of the newest entry. */
  lastOn: string;
};

/** The unit a tally is kept under: case and surrounding space ignored. */
const unitKey = (unit: string | null): string => unit?.trim().toLowerCase() ?? '';

/**
 * Each item's entries, tallies and last-touched day, by item id. An item with
 * no entries is not in the result, so a step without any reads as before.
 */
export function summariseProgress(
  entries: readonly ProgressEntry[],
): Record<string, ItemProgress> {
  const byItem = new Map<string, ProgressEntry[]>();
  for (const entry of sortProgressEntries(entries)) {
    const list = byItem.get(entry.itemId) ?? [];
    list.push(entry);
    byItem.set(entry.itemId, list);
  }
  const out: Record<string, ItemProgress> = {};
  for (const [itemId, list] of byItem) {
    const tallies = new Map<string, ProgressTally>();
    for (const entry of list) {
      if (entry.quantity === null) continue;
      const key = unitKey(entry.unit);
      const tally = tallies.get(key);
      if (tally) tally.quantity += entry.quantity;
      else tallies.set(key, { quantity: entry.quantity, unit: entry.unit?.trim() || null });
    }
    out[itemId] = { entries: list, tallies: [...tallies.values()], lastOn: list[0].happenedOn };
  }
  return out;
}

/** An amount as a person writes it: 7, 2.5, never 2.4999999. */
export function formatQuantity(quantity: number): string {
  return String(Math.round(quantity * 100) / 100);
}

/** "2 bags", or "2" when the amount has no unit. */
export function amountWords(quantity: number, unit: string | null): string {
  return unit ? `${formatQuantity(quantity)} ${unit}` : formatQuantity(quantity);
}

/**
 * The running tally as a phrase: "7 bags so far", "7 bags and 3 boxes so
 * far". Null when no entry gave an amount.
 */
export function tallyWords(tallies: readonly ProgressTally[]): string | null {
  if (tallies.length === 0) return null;
  const parts = tallies.map((tally) => amountWords(tally.quantity, tally.unit));
  const joined =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${joined} so far`;
}

/** The latest progress somewhere beneath a step: the day and the step it was on. */
export type LatestBeneath = { on: string; stepId: string; title: string };

type ProgressTreeNode = { id: string; title: string; children: readonly ProgressTreeNode[] };

/**
 * For each step with sub-steps, the newest entry on any step beneath it, so
 * a parent reads as touched when its child was. Steps with nothing beneath
 * them are not in the result.
 */
export function latestBeneath(
  nodes: readonly ProgressTreeNode[],
  progress: Readonly<Record<string, ItemProgress>>,
): Record<string, LatestBeneath> {
  const out: Record<string, LatestBeneath> = {};
  // The newest of a node's own entries and everything under it.
  const walk = (node: ProgressTreeNode): LatestBeneath | null => {
    let best: LatestBeneath | null = null;
    for (const child of node.children) {
      const found = walk(child);
      if (found && (!best || found.on > best.on)) best = found;
    }
    if (best) out[node.id] = best;
    const own = progress[node.id];
    if (own && (!best || own.lastOn >= best.on)) {
      return { on: own.lastOn, stepId: node.id, title: node.title };
    }
    return best;
  };
  for (const node of nodes) walk(node);
  return out;
}

/** The newest day of any entry in the summary, or null when there is none. */
export function lastProgressOn(progress: Readonly<Record<string, ItemProgress>>): string | null {
  let last: string | null = null;
  for (const item of Object.values(progress)) if (!last || item.lastOn > last) last = item.lastOn;
  return last;
}

/**
 * A step's estimated total and how far its entries are towards it (plan
 * #1277). `done` sums the entries in the total's unit; `left` is never below
 * nothing.
 */
export type TowardsTotal = { done: number; total: number; left: number; unit: string };

/**
 * The unit a total is compared under: case, surrounding space and a plural
 * "s" ignored, so a total of 100 bags counts an entry of 1 bag.
 */
const totalKey = (unit: string | null | undefined): string =>
  (unit?.trim().toLowerCase() ?? '').replace(/s$/, '');

/** Whether an amount in this unit counts towards a total in that one. */
export function sameTotalUnit(a: string | null | undefined, b: string | null | undefined): boolean {
  const key = totalKey(a);
  return key !== '' && key === totalKey(b);
}

/**
 * How far the tallies are towards a step's estimated total. Null when the
 * step has no total. A step with a total and nothing yet logged in its unit
 * is 0 of the total.
 */
export function towardsTotal(
  total: number | null | undefined,
  unit: string | null | undefined,
  tallies: readonly ProgressTally[],
): TowardsTotal | null {
  if (!total || !(total > 0) || !unit?.trim()) return null;
  const done = tallies
    .filter((tally) => sameTotalUnit(tally.unit, unit))
    .reduce((sum, tally) => sum + tally.quantity, 0);
  return { done, total, left: Math.max(0, total - done), unit: unit.trim() };
}

/** The tallies in any unit other than the total's, for saying beside it. */
export function talliesBesideTotal(
  tallies: readonly ProgressTally[],
  unit: string | null | undefined,
): ProgressTally[] {
  return tallies.filter((tally) => !sameTotalUnit(tally.unit, unit));
}

/**
 * On the step: "7 of about 100 bags, about 93 to go". The total is an
 * estimate, so what is left is said as one, and never as a percentage. At or
 * past it: "102 of about 100 bags, the estimate reached".
 */
export function towardsTotalWords(towards: TowardsTotal): string {
  const of = `${formatQuantity(towards.done)} of about ${amountWords(towards.total, towards.unit)}`;
  return towards.left > 0
    ? `${of}, about ${formatQuantity(towards.left)} to go`
    : `${of}, the estimate reached`;
}

/**
 * In the filed line, after what was logged: "about 93 to go of roughly 100",
 * or "the estimate of about 100 reached".
 */
export function leftWords(towards: TowardsTotal): string {
  return towards.left > 0
    ? `about ${formatQuantity(towards.left)} to go of roughly ${formatQuantity(towards.total)}`
    : `the estimate of about ${formatQuantity(towards.total)} reached`;
}

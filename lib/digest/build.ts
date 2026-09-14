import { changelogEntries, featureAbove, type PlanParentRow } from '@/lib/changelog/entries';
import type { FeedbackRow } from '@/lib/feedback/load';
import type { PlanData, PlanItem } from '@/lib/plan/load';
import { buildPlanTree, workOrder } from '@/lib/plan/tree';

/**
 * The morning summary, built from the rows the app already holds.
 *
 * Pure, in the shape `lib/plan/tree.ts` and `lib/changelog/entries.ts` have:
 * rows in, what the page renders out. The writing of it is the daily cron
 * (`inngest/dev/digest.ts`) and the reading of it is `lib/digest/load.ts`;
 * what counts as having happened, and what counts as worth a look, is here
 * where it can be tested without a database.
 *
 * What shipped comes from the changelog rather than from a second filter over
 * the same tables. That list already decides that a dropped step never
 * shipped and that a note has to be fixed rather than declined, and two
 * definitions of "what landed yesterday" would eventually disagree.
 */

export type DigestEventKind = 'step' | 'note' | 'decision';

export type DigestEvent = {
  kind: DigestEventKind;
  title: string;
  /** The plan step's `#12`. Null for a note, which has no number. */
  ref: string | null;
  /** The commit that shipped it, short. Null on an answered question. */
  commit: string | null;
  /** The answer to a question, or what was done about a note. */
  note: string | null;
  /** When it closed. ISO, as the row stored it. */
  at: string;
  /**
   * The feature it closed under, when it closed under one. Null on a note,
   * which belongs to no feature, on a feature's own row, and on every summary
   * written before there was a field for it.
   */
  feature: DigestFeature | null;
};

export type DigestFeature = { ref: string; title: string };

/**
 * What closed, under the feature it closed under.
 *
 * The flat list is one line per closed row, and a day of real work is fifty of
 * them. Under the feature they belong to, the same fifty are six or seven
 * headings you can read in the order they landed.
 */
export type DigestGroup = {
  key: string;
  /** The feature's title, or what to call the rows that belong to none. */
  label: string;
  /** The feature's `#430`. Null on the group of rows that belong to none. */
  ref: string | null;
  events: DigestEvent[];
};

export type DigestPointerKind = 'decision' | 'ready' | 'suggestion';

export type DigestPointer = {
  kind: DigestPointerKind;
  title: string;
  ref: string | null;
  /** Why it is on the list. Carried by a suggestion; usually null otherwise. */
  detail: string | null;
};

/** Long enough to recognise the row, short enough that ten of them are a list. */
const TITLE_LIMIT = 120;
const NOTE_LIMIT = 200;

/**
 * How many closed rows the summary prints before it stops and says how many
 * more there were. Fifteen is about a screen; the changelog has the rest.
 */
export const MAX_HAPPENED = 15;

/** How many of each kind the list is allowed. */
export const MAX_READY = 5;
export const MAX_DECISIONS = 3;
export const MAX_SUGGESTIONS = 3;

/**
 * One line of it, cut at a word if it has to be cut.
 *
 * A note is a paragraph somebody typed into a bug report and a plan title is
 * a sentence; both go on one row here, and a summary that wraps to six lines
 * is a summary nobody reads to the bottom of.
 */
export function oneLine(text: string, limit = TITLE_LIMIT): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Seven characters, the same as the changelog shows. */
function shortSha(sha: string | null): string | null {
  return sha ? sha.slice(0, 7) : null;
}

/**
 * A question settled since the window opened.
 *
 * The changelog leaves these out on purpose -- answering a question changes
 * the plan rather than the app, and there is no commit behind it. Here it is
 * exactly what you want to be told: it is the thing that was waiting on you
 * yesterday and is not waiting on you today.
 */
function answeredDecisions(
  items: readonly PlanItem[],
  since: string,
  byId: ReadonlyMap<string, PlanParentRow>,
): DigestEvent[] {
  return items
    .filter(
      (item) =>
        item.kind === 'decision' &&
        item.status === 'done' &&
        item.completedAt !== null &&
        item.completedAt >= since,
    )
    .map((item) => ({
      kind: 'decision' as const,
      title: oneLine(item.title),
      ref: `#${item.number}`,
      commit: null,
      note: item.resolution ? oneLine(item.resolution, NOTE_LIMIT) : null,
      at: item.completedAt as string,
      feature: featureFrom(featureAbove(item.parentId, byId)),
    }));
}

/** The feature as an event carries it: what a heading needs and nothing else. */
function featureFrom(issue: { number: number; title: string } | null): DigestFeature | null {
  return issue ? { ref: `#${issue.number}`, title: oneLine(issue.title) } : null;
}

/** Every plan row, thin, so a shipped step can name the feature above it. */
function parentsOf(items: readonly PlanItem[]): PlanParentRow[] {
  return items.map((item) => ({
    id: item.id,
    number: item.number,
    title: item.title,
    parentId: item.parentId,
  }));
}

/**
 * What landed since `since`, newest first.
 *
 * The window is an instant rather than a calendar day: the run is a rolling
 * twenty-four hours, so a step closed at eleven last night is on this morning's
 * summary rather than on one nobody will read.
 */
export function whatHappened(input: {
  plan: PlanData;
  notes: readonly FeedbackRow[];
  since: string;
}): DigestEvent[] {
  const shipped = changelogEntries({
    plan: input.plan.items,
    planParents: parentsOf(input.plan.items),
    notes: input.notes,
  })
    .filter((entry) => entry.at >= input.since)
    .map((entry) => ({
      kind: entry.source === 'plan' ? ('step' as const) : ('note' as const),
      title: oneLine(entry.title),
      ref: entry.number === null ? null : `#${entry.number}`,
      commit: shortSha(entry.commitSha),
      note: entry.source === 'note' && entry.detail ? oneLine(entry.detail, NOTE_LIMIT) : null,
      at: entry.at,
      feature: featureFrom(entry.issue),
    }));

  const byId = new Map(parentsOf(input.plan.items).map((row) => [row.id, row]));

  return [...shipped, ...answeredDecisions(input.plan.items, input.since, byId)].sort((a, b) =>
    b.at.localeCompare(a.at),
  );
}

/**
 * Which heading an event sits under.
 *
 * A step goes under its feature. A feature's own closed row keys on itself, so
 * the feature and the steps that shipped it land in one group rather than in
 * two -- the same merge the changelog makes, and for the same reason. A note
 * belongs to no feature and every note goes in one group, because one heading
 * per bug report is the flat list again with more furniture.
 */
function groupOf(event: DigestEvent): Omit<DigestGroup, 'events'> {
  if (event.feature) {
    return { key: event.feature.ref, label: event.feature.title, ref: event.feature.ref };
  }
  if (event.kind === 'note') return { key: 'notes', label: 'Bugs and requests', ref: null };
  if (event.ref) return { key: event.ref, label: event.title, ref: event.ref };
  return { key: 'loose', label: 'Everything else', ref: null };
}

/**
 * The first `limit` events, under their headings, and how many were left.
 *
 * Cut before grouping rather than after, so the number the page prints is the
 * number of rows it is not showing you. The groups come back in the order
 * their newest event landed, which is the order the events were already in.
 */
export function groupHappened(
  events: readonly DigestEvent[],
  limit = MAX_HAPPENED,
): { groups: DigestGroup[]; more: number } {
  const shown = events.slice(0, limit);
  const groups = new Map<string, DigestGroup>();

  for (const event of shown) {
    const heading = groupOf(event);
    const found = groups.get(heading.key);
    if (found) found.events.push(event);
    else groups.set(heading.key, { ...heading, events: [event] });
  }

  return { groups: [...groups.values()], more: Math.max(0, events.length - shown.length) };
}

/**
 * What to look at, before anything a model has to say about it.
 *
 * Questions first: an unanswered one holds up everything under it and nothing
 * a session does moves it. Then what could be picked up, in the order
 * `workOrder` gives, which is the order the plan page and the CLI already
 * agree on.
 */
export function whatIsReady(plan: PlanData): DigestPointer[] {
  const ready = workOrder(buildPlanTree(plan));

  const decisions = ready
    .filter((node) => node.kind === 'decision')
    .slice(0, MAX_DECISIONS)
    .map((node) => ({
      kind: 'decision' as const,
      title: oneLine(node.title),
      ref: `#${node.number}`,
      detail: null,
    }));

  const steps = ready
    .filter((node) => node.kind !== 'decision')
    .slice(0, MAX_READY)
    .map((node) => ({
      kind: 'ready' as const,
      title: oneLine(node.title),
      ref: `#${node.number}`,
      detail: null,
    }));

  return [...decisions, ...steps];
}

/** The model's half, capped and cleaned, on the end of the computed half. */
export function withSuggestions(
  pointers: readonly DigestPointer[],
  suggestions: readonly { title: string; detail: string | null }[],
): DigestPointer[] {
  const noticed = suggestions
    .filter((suggestion) => suggestion.title.trim().length > 0)
    .slice(0, MAX_SUGGESTIONS)
    .map((suggestion) => ({
      kind: 'suggestion' as const,
      title: oneLine(suggestion.title),
      ref: null,
      detail: suggestion.detail ? oneLine(suggestion.detail, NOTE_LIMIT) : null,
    }));

  return [...pointers, ...noticed];
}

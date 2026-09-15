import type { Concept } from '@/lib/learn/graph/model';
import { rankReady, type ReadyConcept } from '@/lib/learn/graph/ready';
import { oldEnough, rankByLastChecked, type SettledConcept } from '@/lib/learn/graph/recheck';

/**
 * The three kinds of thing Learn next can offer, in one order.
 *
 * `ready.ts` orders what could be started, `recheck.ts` orders what has gone
 * longest without being asked about, and the reading queue holds what you said
 * you would read and have not opened. Each of those orders is right about its
 * own kind and says nothing about the other two, so what is written here is
 * only how the three lists interleave.
 *
 * Pure, and it takes `now` rather than reading the clock, so the order is
 * testable against rows written by hand. The reading that feeds it lives in
 * `lib/learn/graph/load.ts`.
 */

/** How many rows the screen shows, the same cut `/learn/next` has always made. */
export const NEXT_LIMIT = 8;

export type NextKind = 'ready' | 'recheck' | 'reading';

type Shared<K extends NextKind> = {
  kind: K;
  /** Unique across the three kinds, since a claim can be behind two of them. */
  key: string;
  /** What the row is called on screen. */
  title: string;
  /** Where the row goes when you press it. */
  href: string;
  /** One line saying why this is on the list, in the person's terms. */
  reason: string;
  subjectId: string;
  subjectName: string;
};

/** A claim with nothing missing underneath it. */
export type NextReady = Shared<'ready'> & {
  concept: Concept;
  stepsToGoal: number | null;
};

/** A claim you answered about long enough ago to be worth asking again. */
export type NextRecheck = Shared<'recheck'> & {
  concept: Concept;
  testedAt: string;
};

/** A reading queued against a claim and never opened. */
export type NextReading = Shared<'reading'> & {
  readingId: string;
  conceptName: string;
  queuedAt: string;
};

export type NextRow = NextReady | NextRecheck | NextReading;

/**
 * A reading in the queue that names the claim it was put there to close.
 *
 * `to-queue.ts` writes `concept_id` when a gap in a graph is queued, and a
 * reading you wrote down yourself has none. Only the ones that name a claim
 * can be shown here, because only they can say what they are about.
 */
export type QueuedReading = {
  id: string;
  /** The source's title, or your own words when no source has been found. */
  title: string;
  conceptId: string;
  conceptName: string;
  subjectId: string;
  subjectName: string;
  /** When it went into the queue. */
  queuedAt: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function probeHref(subjectId: string, conceptId: string): string {
  return `/learn/s/${subjectId}/probe?concept=${conceptId}`;
}

/**
 * How long ago, in the largest unit that still says something useful.
 *
 * A month here is a twelfth of a year rather than thirty days, because thirty
 * adds a month somewhere around August and the sentence is read against a
 * calendar.
 */
const DAYS_PER_MONTH = 365.25 / 12;

function ago(days: number): string {
  if (days < 60) return `${days} ${days === 1 ? 'day' : 'days'}`;
  const months = Math.round(days / DAYS_PER_MONTH);
  if (months < 24) return `${months} months`;
  return `${Math.round(days / 365.25)} years`;
}

/**
 * Why a ready claim is here: how far it is from something you asked for.
 *
 * A claim with no goal above it gets the plain sentence rather than a made-up
 * distance, because "nothing is missing underneath it" is the whole of why it
 * is offered.
 */
export function readyReason(stepsToGoal: number | null): string {
  if (stepsToGoal === null) return 'Nothing is missing underneath it.';
  if (stepsToGoal === 0) return 'A goal you named, and nothing is missing underneath it.';
  if (stepsToGoal === 1) return 'One step from a goal you named.';
  return `${stepsToGoal} steps from a goal you named.`;
}

export function recheckReason(testedAt: string, now: Date): string {
  const days = Math.floor((now.getTime() - new Date(testedAt).getTime()) / DAY_MS);
  return `Answered ${ago(Math.max(days, 0))} ago and not asked about since.`;
}

export function readingReason(conceptName: string): string {
  return `Queued about ${conceptName}, and never opened.`;
}

function toReadyRow(row: ReadyConcept): NextReady {
  return {
    kind: 'ready',
    key: `ready:${row.concept.id}`,
    title: row.concept.name,
    href: probeHref(row.subjectId, row.concept.id),
    reason: readyReason(row.stepsToGoal),
    subjectId: row.subjectId,
    subjectName: row.subjectName,
    concept: row.concept,
    stepsToGoal: row.stepsToGoal,
  };
}

function toRecheckRow(row: SettledConcept, now: Date): NextRecheck {
  return {
    kind: 'recheck',
    key: `recheck:${row.concept.id}`,
    title: row.concept.name,
    href: probeHref(row.subjectId, row.concept.id),
    reason: recheckReason(row.testedAt, now),
    subjectId: row.subjectId,
    subjectName: row.subjectName,
    concept: row.concept,
    testedAt: row.testedAt,
  };
}

function toReadingRow(reading: QueuedReading): NextReading {
  return {
    kind: 'reading',
    key: `reading:${reading.id}`,
    title: reading.title,
    href: `/learn/r/${reading.id}`,
    reason: readingReason(reading.conceptName),
    subjectId: reading.subjectId,
    subjectName: reading.subjectName,
    readingId: reading.id,
    conceptName: reading.conceptName,
    queuedAt: reading.queuedAt,
  };
}

/**
 * Longest in the queue first.
 *
 * The one you left longest is the one you are least likely to open on your
 * own, and it is the only thing a queued reading can be ordered by: nothing
 * records what you meant to read first.
 */
export function rankQueuedReadings(readings: QueuedReading[]): QueuedReading[] {
  return [...readings].sort((a, b) => {
    const byDate = new Date(a.queuedAt).getTime() - new Date(b.queuedAt).getTime();
    if (byDate !== 0) return byDate;

    const byTitle = a.title.localeCompare(b.title);
    return byTitle !== 0 ? byTitle : a.id.localeCompare(b.id);
  });
}

/**
 * One from each kind in turn, skipping a kind that has run out.
 *
 * Taking turns rather than scoring the three kinds against each other, because
 * there is no honest common unit: two steps from a goal and seven months
 * unchecked are not comparable numbers, and inventing a weight that made them
 * so would be a rule nobody had agreed to. Turns give the top of the screen
 * one of each kind when all three exist, and collapse to a single kind's own
 * order when only one does.
 */
function takeTurns(lists: NextRow[][], limit: number): NextRow[] {
  const rows: NextRow[] = [];
  const taken = lists.map(() => 0);

  let moved = true;
  while (rows.length < limit && moved) {
    moved = false;
    for (let i = 0; i < lists.length && rows.length < limit; i += 1) {
      const row = lists[i][taken[i]];
      if (row === undefined) continue;
      taken[i] += 1;
      rows.push(row);
      moved = true;
    }
  }

  return rows;
}

export type NextInput = {
  ready: ReadyConcept[];
  settled: SettledConcept[];
  readings: QueuedReading[];
};

/**
 * What Learn next shows, in the order it shows it.
 *
 * Settled claims are cut to the ones old enough to be worth asking about
 * again, which is `recheck.ts`'s cutoff rather than a second one written here.
 * Everything that survives keeps its own kind's order, and the kinds then take
 * turns. An account with nothing in it gets an empty list, which is a page
 * state rather than an error.
 */
export function rankNext(input: NextInput, now: Date, limit: number = NEXT_LIMIT): NextRow[] {
  const ready = rankReady(input.ready, input.ready.length).map(toReadyRow);
  const recheck = rankByLastChecked(input.settled.filter((row) => oldEnough(row.testedAt, now)))
    .map((row) => toRecheckRow(row, now));
  const readings = rankQueuedReadings(input.readings).map(toReadingRow);

  return takeTurns([ready, recheck, readings], limit);
}

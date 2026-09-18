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

/** What you did with a row, the three outcomes `learn.next_outcomes` holds. */
export type NextOutcome = 'answered' | 'read' | 'not_now';

/**
 * One thing you did with something this page offered.
 *
 * Three outcomes and nothing else, which is #479's answer: a question answered
 * about a claim, a reading marked read, a row pushed aside. There is no field
 * here for a row being shown, opened or looked at, and that absence is the
 * rule rather than an omission -- the order is computed from what is in this
 * type, so a signal that cannot be written cannot be weighed.
 *
 * `subjectId` is the subject the claim belongs to, resolved by the loader; it
 * is null when the claim has since been deleted.
 */
export type NextRecord = {
  outcome: NextOutcome;
  conceptId: string | null;
  readingId: string | null;
  subjectId: string | null;
  happenedAt: string;
};

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

/**
 * How far back the record is read.
 *
 * Something you finished in the spring says nothing about what you are working
 * on now, and a window keeps the query the loader makes a small one. Sixty
 * days is long enough to hold a Not now through its three weeks and still show
 * where it came from afterwards.
 */
export const RECORD_WINDOW_DAYS = 60;

/**
 * How long a Not now keeps a row down.
 *
 * #479 settled this as a few weeks. After it, the row comes back in its own
 * kind's order and its reason says you had pushed it aside, rather than
 * reappearing as though nothing had happened.
 */
export const PUSHED_ASIDE_DAYS = 21;

/** The start of the window, for the loader's `where happened_at >= …`. */
export function recordWindowStart(now: Date): Date {
  return new Date(now.getTime() - RECORD_WINDOW_DAYS * DAY_MS);
}

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

/**
 * What the record adds up to, read once for the whole list.
 *
 * Two things come out of it: when each claim or reading was last pushed aside,
 * and how much has been finished lately in each subject. Anything older than
 * the window is dropped here, so the rest of the file can treat what is left
 * as recent.
 */
type Digest = {
  /** Days since you last pushed this claim or reading aside. */
  asideDays: Map<string, number>;
  /** Questions answered and readings read, by subject. */
  finished: Map<string, number>;
};

function conceptTarget(conceptId: string): string {
  return `concept:${conceptId}`;
}

function readingTarget(readingId: string): string {
  return `reading:${readingId}`;
}

function targetOf(row: NextRow): string {
  return row.kind === 'reading' ? readingTarget(row.readingId) : conceptTarget(row.concept.id);
}

export function readRecord(record: NextRecord[], now: Date): Digest {
  const asideDays = new Map<string, number>();
  const finished = new Map<string, number>();

  for (const entry of record) {
    const days = Math.floor((now.getTime() - new Date(entry.happenedAt).getTime()) / DAY_MS);
    if (Number.isNaN(days) || days < 0 || days > RECORD_WINDOW_DAYS) continue;

    if (entry.outcome === 'not_now') {
      const target =
        entry.readingId !== null
          ? readingTarget(entry.readingId)
          : entry.conceptId !== null
            ? conceptTarget(entry.conceptId)
            : null;
      if (target === null) continue;

      // The most recent one is the one that counts: pushing the same row aside
      // twice is two acts of putting it off, not one that expired.
      const seen = asideDays.get(target);
      if (seen === undefined || days < seen) asideDays.set(target, days);
      continue;
    }

    // Answered and read are the same signal here -- you got through something
    // in that subject -- and a claim that has since been deleted carries no
    // subject to credit.
    if (entry.subjectId === null) continue;
    finished.set(entry.subjectId, (finished.get(entry.subjectId) ?? 0) + 1);
  }

  return { asideDays, finished };
}

function pushedAside(row: NextRow, record: Digest): number | undefined {
  return record.asideDays.get(targetOf(row));
}

/** A row you put off, still inside the few weeks you put it off for. */
function held(row: NextRow, record: Digest): boolean {
  const days = pushedAside(row, record);
  return days !== undefined && days < PUSHED_ASIDE_DAYS;
}

function finishedIn(row: NextRow, record: Digest): number {
  return record.finished.get(row.subjectId) ?? 0;
}

/** Said on the row itself, so a row that went away and came back explains it. */
export function pushedAsideNote(days: number): string {
  return days === 0 ? 'You pushed this aside today.' : `You pushed this aside ${ago(days)} ago.`;
}

function reasonWith(base: string, row: NextRow, record: Digest): string {
  const days = pushedAside(row, record);
  return days === undefined ? base : `${base} ${pushedAsideNote(days)}`;
}

/**
 * The record's effect on one kind's order.
 *
 * Two moves, both from #479: a row you pushed aside goes to the back of its
 * kind until the few weeks are up, and a subject you have been finishing
 * things in comes before one you have not touched. Underneath both, the kind's
 * own order holds -- distance to a goal, or longest since asked about -- since
 * the sort is stable and rows that tie on the record keep the order they came
 * in with.
 */
function byRecord<T extends NextRow>(rows: T[], record: Digest): T[] {
  return [...rows].sort((a, b) => {
    const byHold = Number(held(a, record)) - Number(held(b, record));
    if (byHold !== 0) return byHold;

    return finishedIn(b, record) - finishedIn(a, record);
  });
}

function toReadyRow(row: ReadyConcept, record: Digest): NextReady {
  const built: NextReady = {
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

  return { ...built, reason: reasonWith(built.reason, built, record) };
}

function toRecheckRow(row: SettledConcept, now: Date, record: Digest): NextRecheck {
  const built: NextRecheck = {
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

  return { ...built, reason: reasonWith(built.reason, built, record) };
}

function toReadingRow(reading: QueuedReading, record: Digest): NextReading {
  const built: NextReading = {
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

  return { ...built, reason: reasonWith(built.reason, built, record) };
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
  /** What you have done with what was offered before, most recent first. */
  record: NextRecord[];
};

/**
 * What Learn next shows, in the order it shows it.
 *
 * Settled claims are cut to the ones old enough to be worth asking about
 * again, which is `recheck.ts`'s cutoff rather than a second one written here.
 * Each kind then keeps its own order with the record applied on top of it --
 * held-down rows to the back, subjects you are getting through to the front --
 * and the three kinds take turns. An account with nothing in it gets an empty
 * list, which is a page state rather than an error.
 *
 * Three things decide the order and there is no fourth: how close a claim is
 * to a goal you named and what state it is in, how long a settled claim has
 * gone unasked, and what you finished or pushed aside. Nothing counts a row
 * being shown, opened or looked at.
 */
export function rankNext(input: NextInput, now: Date, limit: number = NEXT_LIMIT): NextRow[] {
  const record = readRecord(input.record, now);

  const ready = byRecord(
    rankReady(input.ready, input.ready.length).map((row) => toReadyRow(row, record)),
    record,
  );
  const recheck = byRecord(
    rankByLastChecked(input.settled.filter((row) => oldEnough(row.testedAt, now))).map((row) =>
      toRecheckRow(row, now, record),
    ),
    record,
  );
  const readings = byRecord(
    rankQueuedReadings(input.readings).map((row) => toReadingRow(row, record)),
    record,
  );

  return takeTurns([ready, recheck, readings], limit);
}

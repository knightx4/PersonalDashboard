import type { Basis } from '@/lib/learn/reader/source';

/**
 * How the reader's home screen sorts what there is to read
 * (docs/LEARN-READER-SPEC.md). Plain rules, no model: what you started comes
 * first, then what was chosen against your notes, then what is new to you,
 * then what you asked for. Kept apart from the store so it can be tested and
 * a client component can use its types.
 */

export type ReaderStatus = 'queued' | 'preparing' | 'ready' | 'failed';
export type Origin = 'note' | 'new' | 'asked' | 'deeper' | 'refill';

export type ReaderRow = {
  id: string;
  title: string;
  author: string | null;
  origin: Origin;
  why: string | null;
  status: ReaderStatus;
  basis: Basis | null;
  /** Sections read, counted from 1. */
  read: number[];
  verdict: 'kept' | 'dropped' | null;
  parentId: string | null;
  openedAt: string | null;
  requestedAt: string;
  outline: {
    published: string | null;
    minutes: number;
    idea: string;
    sections: { title: string; minutes: number; idea: string }[];
  } | null;
};

export type MetIdea = {
  sourceId: string;
  source: string;
  section: number;
  title: string;
  idea: string;
};

export type Shelves = {
  /** Started and not finished, the one opened last first. */
  continuing: ReaderRow[];
  /** Chosen against a note of theirs, not yet opened. */
  near: ReaderRow[];
  /** Territory they have not touched, not yet opened. */
  fresh: ReaderRow[];
  /** What they asked for, a topic or a Go deeper, ready and not yet opened. */
  asked: ReaderRow[];
  /** Being prepared or waiting to be, and what stopped. */
  coming: ReaderRow[];
  /** Read to the end. */
  finished: ReaderRow[];
  /** The one-idea line of every section read, newest source first. */
  ideas: MetIdea[];
  /** A request for more to read is waiting or running. */
  finding: boolean;
};

/** The first section not yet read, counted from 1, or null when all are. */
export function nextSection(row: ReaderRow): number | null {
  const total = row.outline?.sections.length ?? 0;
  for (let n = 1; n <= total; n += 1) if (!row.read.includes(n)) return n;
  return null;
}

export function minutesLeft(row: ReaderRow): number {
  return (row.outline?.sections ?? []).reduce(
    (sum, section, index) => sum + (row.read.includes(index + 1) ? 0 : section.minutes),
    0,
  );
}

export function shelve(rows: readonly ReaderRow[]): Shelves {
  const shelves: Shelves = {
    continuing: [],
    near: [],
    fresh: [],
    asked: [],
    coming: [],
    finished: [],
    ideas: [],
    finding: false,
  };
  for (const row of rows) {
    if (row.origin === 'refill') {
      if (row.status === 'queued' || row.status === 'preparing') shelves.finding = true;
      continue;
    }
    // A source being prepared again from the person's own copy stays readable meanwhile.
    if (row.status !== 'ready' && !row.outline) {
      shelves.coming.push(row);
      continue;
    }
    if (row.verdict === 'dropped') continue;
    for (const n of row.read) {
      const section = row.outline?.sections[n - 1];
      if (section)
        shelves.ideas.push({
          sourceId: row.id,
          source: row.title,
          section: n,
          title: section.title,
          idea: section.idea,
        });
    }
    if (row.read.length > 0 && nextSection(row) === null) shelves.finished.push(row);
    else if (row.read.length > 0) shelves.continuing.push(row);
    else if (row.origin === 'note') shelves.near.push(row);
    else if (row.origin === 'new') shelves.fresh.push(row);
    else shelves.asked.push(row);
  }
  const opened = (row: ReaderRow) => row.openedAt ?? row.requestedAt;
  shelves.continuing.sort((a, b) => opened(b).localeCompare(opened(a)));
  return shelves;
}

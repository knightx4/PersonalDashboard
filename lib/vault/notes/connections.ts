import { RELATED_NOTE_MIN_SIMILARITY } from '@/lib/vault/notes/related';

/**
 * Which of this week's notes to point out as coming back to older ones
 * (plan #1115, under #1110).
 *
 * obsidian.recent_note_neighbours gives each note written in during the last
 * seven days with its nearest older notes. Most of those pairs are true and
 * not worth saying. Read against the live vault in September 2026, the
 * nearest older note to a new course summary was nearly always the course
 * notes it summarised (0.85 to 0.94), and a new job application sat next to
 * the other applications (0.7 and up, see #1114). Telling the person that
 * their MGT 850 summary resembles their MGT 850 notes teaches them to skip the
 * panel. The pairs worth reading were the ones across subjects they had not
 * named alike: a well-being course next to a note on following your passion,
 * an operations course next to their notes on The Goal, a note on AI slop next
 * to a new one on AI tricks.
 *
 * So a pair is dropped when:
 *
 * - it is under RELATED_NOTE_MIN_SIMILARITY (0.55), the floor #1112 set;
 * - it is at or over CONNECTION_MAX_SIMILARITY (0.85), which on the live vault
 *   was the same material written twice: a summary and its source, a quiz and
 *   its answer key;
 * - the recent note is not among the older note's own MUTUAL_RANK_MAX
 *   nearest notes. Some older notes are near everything: a problem set full
 *   of formulas was the nearest older note to seven different course notes,
 *   and grouped by older note those hubs filled every slot. Asking from both
 *   ends drops them (vault migration 0026 has the numbers);
 * - the two titles share a word (MGT, Galaxy, Property, Application), since a
 *   connection the person already named is one they know about;
 * - both notes are in a Job Applications folder (#1114's finding), which the
 *   title rule misses when the files are named by company;
 * - either note is an index or an export: a title starting with an underscore
 *   (_Index, _Master Summary), or more than EXPORT_CHARS of prose, which is a
 *   paste or a compilation rather than something written (Yale Combined is
 *   383,000 characters).
 *
 * What is left is grouped by the older note, since the useful thing to say is
 * "these notes this week come back to that one", and each recent note joins
 * only the group of its closest remaining older note. Within a group, a
 * recent note whose title is mostly the same words as one already in it is
 * left out: the vault held a course's notes and its summary under nearly the
 * same name, and naming both reads as a duplicate. Groups with more recent
 * notes come first, then the closer ones, and at most CONNECTIONS_SHOWN are
 * kept, so the panel stays short enough to read.
 */

export const CONNECTION_MIN_SIMILARITY = RELATED_NOTE_MIN_SIMILARITY;

/** At or above this, two notes are the same material twice. */
export const CONNECTION_MAX_SIMILARITY = 0.85;

/** Connections kept in a week. */
export const CONNECTIONS_SHOWN = 3;

/** Recent notes named in one connection. */
export const RECENT_PER_CONNECTION = 3;

/** How many older neighbours each recent note is looked up with. */
export const NEIGHBOURS_PER_NOTE = 5;

/** How far down the older note's own neighbours the recent note may sit. */
export const MUTUAL_RANK_MAX = 5;

/** Prose characters beyond which a note is an export or a compilation. */
export const EXPORT_CHARS = 60_000;

/** The days a week looks back over. */
export const CONNECTION_WINDOW_DAYS = 7;

/** One row from obsidian.recent_note_neighbours. */
export type NeighbourPair = {
  recentId: string;
  recentPath: string;
  recentTitle: string;
  recentChars: number;
  olderId: string;
  olderPath: string;
  olderTitle: string;
  olderChars: number;
  similarity: number;
  /** Where the recent note ranks among the older note's own nearest notes, 1 = nearest. */
  mutualRank: number;
};

export type ConnectionNote = { id: string; path: string; title: string };

export type PickedConnection = {
  older: ConnectionNote;
  /** Closest first, one to RECENT_PER_CONNECTION. */
  recent: ConnectionNote[];
  /** The closest pair in the group. */
  similarity: number;
};

/** Words too common to say two notes share a subject. */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'at', 'by', 'for', 'from', 'how', 'in', 'into', 'is', 'it',
  'my', 'of', 'on', 'or', 'the', 'to', 'untitled', 'what', 'why', 'with',
]);

/** The words of a title that could name its subject, lower-cased. */
export function titleWords(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .replace(/\.md$/, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word))
    // "applications" and "application" are one word here.
    .map((word) => (word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word));
  return new Set(words);
}

export function sharesTitleWord(a: string, b: string): boolean {
  const left = titleWords(a);
  for (const word of titleWords(b)) if (left.has(word)) return true;
  return false;
}

/** Whether two titles are mostly the same words: half or more of them shared. */
export function nearlySameTitle(a: string, b: string): boolean {
  const left = titleWords(a);
  const right = titleWords(b);
  if (left.size === 0 || right.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let shared = 0;
  for (const word of right) if (left.has(word)) shared += 1;
  return shared / (left.size + right.size - shared) >= 0.5;
}

const APPLICATIONS_FOLDER = /(^|\/)job applications\//i;

function isExport(title: string, chars: number): boolean {
  return title.trim().startsWith('_') || chars > EXPORT_CHARS;
}

/** Why a pair is left out, or null when it is kept. For the tests and the run's summary. */
export function droppedBecause(pair: NeighbourPair): string | null {
  if (!Number.isFinite(pair.similarity) || pair.similarity < CONNECTION_MIN_SIMILARITY) return 'weak';
  if (pair.similarity >= CONNECTION_MAX_SIMILARITY) return 'same material';
  if (!(pair.mutualRank <= MUTUAL_RANK_MAX)) return 'hub';
  if (isExport(pair.recentTitle, pair.recentChars) || isExport(pair.olderTitle, pair.olderChars)) {
    return 'export';
  }
  if (APPLICATIONS_FOLDER.test(pair.recentPath) && APPLICATIONS_FOLDER.test(pair.olderPath)) {
    return 'applications';
  }
  if (sharesTitleWord(pair.recentTitle, pair.olderTitle)) return 'named alike';
  return null;
}

/** The week's connections from the neighbour pairs, best first. */
export function pickConnections(pairs: readonly NeighbourPair[]): PickedConnection[] {
  // Each recent note's closest kept older note.
  const best = new Map<string, NeighbourPair>();
  for (const pair of pairs) {
    if (pair.recentId === pair.olderId || droppedBecause(pair)) continue;
    const held = best.get(pair.recentId);
    if (!held || pair.similarity > held.similarity) best.set(pair.recentId, pair);
  }

  const groups = new Map<string, NeighbourPair[]>();
  for (const pair of best.values()) {
    groups.set(pair.olderId, [...(groups.get(pair.olderId) ?? []), pair]);
  }

  return [...groups.values()]
    .map((members) => {
      const sorted = [...members].sort(
        (a, b) => b.similarity - a.similarity || a.recentPath.localeCompare(b.recentPath),
      );
      const first = sorted[0]!;
      const distinct: NeighbourPair[] = [];
      for (const pair of sorted) {
        if (distinct.some((kept) => nearlySameTitle(kept.recentTitle, pair.recentTitle))) continue;
        distinct.push(pair);
      }
      return {
        older: { id: first.olderId, path: first.olderPath, title: first.olderTitle },
        recent: distinct.slice(0, RECENT_PER_CONNECTION).map((pair) => ({
          id: pair.recentId,
          path: pair.recentPath,
          title: pair.recentTitle,
        })),
        similarity: first.similarity,
      };
    })
    .sort(
      (a, b) =>
        b.recent.length - a.recent.length ||
        b.similarity - a.similarity ||
        a.older.path.localeCompare(b.older.path),
    )
    .slice(0, CONNECTIONS_SHOWN);
}

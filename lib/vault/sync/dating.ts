import { firstWritten, type DatedEntry, type FirstWrittenSource } from '@/lib/vault/notes/first-written';

/**
 * The dating pass (plan #2413.2): give each note the day it was first
 * written, after a sync.
 *
 * A note is due when GitHub has not yet been asked for its first commit, or
 * when its blob changed since it was last dated (notes.first_written_due).
 * The first run after this ships is the backfill: about two GitHub requests a
 * note, so it is capped and spread over runs, and it resumes by itself because
 * a note asked about is no longer due. After that, each run dates the notes
 * the sync added or changed.
 *
 * A note whose lookup could not happen this run (no time, the cap, an error)
 * is still dated from its own text, and stays due so the next run asks again.
 * A GitHub answer of "no commits" is an answer, and is recorded.
 */

export type DueNote = {
  id: string;
  path: string;
  body: string;
  frontmatter: Record<string, unknown>;
  blobSha: string;
  gitFirstCommitAt: string | null;
  gitFirstCommitCheckedAt: string | null;
};

export type NoteDating = {
  id: string;
  firstWrittenAt: string | null;
  firstWrittenSource: FirstWrittenSource | null;
  datedEntries: DatedEntry[];
  gitFirstCommitAt: string | null;
  gitFirstCommitCheckedAt: string | null;
  blobSha: string;
};

export type DatingPorts = {
  /** Due notes after `afterPath` in path order, at most `limit`. */
  loadDue(afterPath: string | null, limit: number): Promise<DueNote[]>;
  /** Absent when the source keeps no history. */
  firstCommitAt?: (path: string) => Promise<string | null>;
  save(rows: NoteDating[]): Promise<void>;
  now?(): number;
};

export type DatingSummary = {
  /** Notes whose dates were written this run. */
  dated: number;
  /** Of those, how many GitHub was asked about. */
  lookedUp: number;
  /** Lookups that failed; those notes stay due. */
  failed: number;
  /** False when time or the cap ran out with notes still due. */
  complete: boolean;
};

const PAGE = 100;
const CONCURRENCY = 6;
/** Lookups per run: about two requests each, well inside the token's 5,000 an hour. */
export const LOOKUP_LIMIT = 1_000;
/** After this many failed lookups in a run, the rest go on their own text. */
const FAILURES_BEFORE_STOPPING = 5;

export async function dateNotes(opts: {
  ports: DatingPorts;
  deadline: number;
  lookupLimit?: number;
}): Promise<DatingSummary> {
  const { ports, deadline } = opts;
  const clock = ports.now ?? (() => Date.now());
  const lookupLimit = opts.lookupLimit ?? LOOKUP_LIMIT;
  const summary: DatingSummary = { dated: 0, lookedUp: 0, failed: 0, complete: true };
  let after: string | null = null;
  let lookingUp = Boolean(ports.firstCommitAt);

  for (;;) {
    if (clock() >= deadline) {
      summary.complete = false;
      break;
    }
    const due = await ports.loadDue(after, PAGE);
    if (!due.length) break;
    after = due[due.length - 1].path;

    const rows: NoteDating[] = new Array(due.length);
    let next = 0;
    const work = async () => {
      while (next < due.length) {
        const index = next++;
        const note = due[index];
        let gitAt = note.gitFirstCommitAt;
        let checkedAt = note.gitFirstCommitCheckedAt;

        const ask =
          !checkedAt && lookingUp && ports.firstCommitAt && summary.lookedUp < lookupLimit && clock() < deadline;
        if (ask) {
          summary.lookedUp += 1;
          try {
            gitAt = await ports.firstCommitAt!(note.path);
            checkedAt = new Date(clock()).toISOString();
          } catch {
            summary.failed += 1;
            if (summary.failed >= FAILURES_BEFORE_STOPPING) lookingUp = false;
          }
        }
        if (!checkedAt) summary.complete = false;

        const dated = firstWritten({
          path: note.path,
          body: note.body,
          frontmatter: note.frontmatter,
          gitFirstCommitAt: gitAt,
          now: new Date(clock()),
        });
        rows[index] = {
          id: note.id,
          firstWrittenAt: dated.at,
          firstWrittenSource: dated.source,
          datedEntries: dated.entries,
          gitFirstCommitAt: gitAt,
          gitFirstCommitCheckedAt: checkedAt,
          blobSha: note.blobSha,
        };
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, due.length) }, work));

    await ports.save(rows);
    summary.dated += rows.length;
    if (due.length < PAGE) break;
  }

  return summary;
}

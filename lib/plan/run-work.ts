/**
 * What a routine run left behind in its job's own rows, for ending it.
 *
 * `runEnd` reads one fact: the step the run was sent at closed or blocked. A
 * notes run, a shaping run and a check-back are sent at no step, and a
 * re-shape or a feature batch is sent at a feature that may stay open for
 * days after the session is gone. So every one of those runs reached the
 * two-hour mark with nothing closed and was written off as failed. In the
 * thirty days to 3 October that was 307 of 507 runs, among them notes runs
 * that had closed ten notes and re-shapes that had written their steps.
 *
 * Each job leaves its own trail, and this file says what that trail is and
 * how to read it:
 *
 *  - `notes`: notes in `feedback_items` closed while it ran.
 *  - `check_back`: the check-backs it was woken for (`woke_run_id`), closed.
 *  - `shape`: ideas linked to a top-level row written while it ran.
 *  - `reshape`: rows written beneath the feature, or dropped there, while it
 *    ran; for a feature already closed, a new top-level row naming it.
 *  - `feature`: steps beneath the feature closed or blocked while it ran.
 *  - `overhaul`: the same as `feature`, since it works the steps beneath one
 *    overhaul in their phase order (plan #1514).
 *
 * The notes, shaping and check-back trails are the account's, not the run's:
 * nothing records which note a notes run closed. Two notes runs at once read
 * the same closes, which is a smaller error than reading neither.
 *
 * Pure, so the rules are tested without a database. `runs.ts` does the reads.
 */
import type { RunEnd } from './run-end';

/**
 * How long after a run starts its job's trail is still counted as its own.
 *
 * The sweep that reads a run may come hours after it stopped, when the page is
 * next opened or the tick next looks, and a note the person closed by hand
 * that evening is not the run's work. Six hours is longer than any notes batch
 * the table holds and short of the next day's.
 */
export const WORK_WINDOW_MINUTES = 6 * 60;

/** The jobs whose runs are judged by what they left behind. */
export const WORK_JOBS = ['notes', 'check_back', 'shape', 'reshape', 'feature', 'overhaul'] as const;
export type WorkJob = (typeof WORK_JOBS)[number];

export function readsWork(job: string | null | undefined): job is WorkJob {
  return (WORK_JOBS as readonly string[]).includes(job ?? '');
}

/**
 * Whether a run is judged on the clock rather than on pushes.
 *
 * Notes, shaping and check-back runs mostly write rows rather than commits,
 * and a re-shape never commits, so the push listing says nothing about them.
 * Read through it, the no-output mark wrote off re-shapes thirty minutes in
 * while they were still writing steps. A feature batch and an overhaul run
 * commit, so they keep the push reading.
 */
export function judgedOnClock(job: string | null | undefined): boolean {
  return readsWork(job) && job !== 'feature' && job !== 'overhaul';
}

/** What one run's job left behind, as the sweep read it. */
export type RunWork = {
  /** How many pieces of the job's work were done in the run's window. */
  done: number;
  /**
   * The job's own record says the run is over, whatever the clock says. Only
   * a check-back run has one: every check-back it was woken for is closed.
   */
  over?: boolean;
  /**
   * The job's own rows say a session is still at it: a step beneath the
   * feature is claimed, or something beneath it changed in the last twenty
   * minutes. The same reading the overnight tick takes (`featureRunIdle`).
   */
  busy?: boolean;
};

/** The instants a run's work is counted between. */
export function workWindow(createdAt: string, now: number): { from: string; to: string } {
  const from = new Date(createdAt).getTime();
  return {
    from: new Date(from).toISOString(),
    to: new Date(Math.min(now, from + WORK_WINDOW_MINUTES * 60_000)).toISOString(),
  };
}

/** Whether a stamp falls inside a window. */
export function within(stamp: string | null | undefined, window: { from: string; to: string }) {
  if (!stamp) return false;
  const at = new Date(stamp).getTime();
  return (
    Number.isFinite(at) &&
    at >= new Date(window.from).getTime() &&
    at <= new Date(window.to).getTime()
  );
}

/**
 * The end a run is written back with, once its work has been read.
 *
 * `verdict` is what the clock or the pushes said without the work. A run whose
 * job left work behind is finished when the clock calls time; one that left
 * none is failed, as before. Two readings come before the clock: a check-back
 * run whose check-backs are all closed is over now, and a feature batch whose
 * rows are still moving is not over yet.
 */
export function workedEnd(verdict: RunEnd | null, work: RunWork | null): RunEnd | null {
  if (verdict === 'finished') return 'finished';
  if (!work) return verdict;
  if (work.over) return 'finished';
  if (verdict === null || work.busy) return null;
  return work.done > 0 ? 'finished' : 'failed';
}

/** What a run that left nothing behind did not do, said after its silence. */
const NOTHING_DONE: Record<WorkJob, string> = {
  notes: 'No note was closed while it ran.',
  check_back: 'None of the check-backs it was woken for was closed.',
  shape: 'No idea was shaped into a proposal while it ran.',
  reshape: 'Nothing beneath the feature was added or dropped while it ran.',
  feature: 'No step beneath the feature closed or stopped on a question while it ran.',
  overhaul: 'No step beneath the overhaul closed or stopped on a question while it ran.',
};

/**
 * The reason kept on a run written off with no work to show.
 *
 * The silence alone was all the row used to say, and on a notes run that had
 * closed ten notes it was the wrong half of the story. Saying that nothing was
 * done as well is what tells a dead run from a quiet one that finished.
 */
export function noWorkNote(job: WorkJob, silence: string): string {
  return `${silence} ${NOTHING_DONE[job]}`;
}

/** A plan row, as much of it as the subtree readings need. */
export type WorkRow = {
  id: string;
  parentId: string | null;
  number: number | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  blockedAt: string | null;
};

/** Every row beneath a root, not counting the root. */
export function beneath(rows: readonly WorkRow[], root: string): WorkRow[] {
  const children = new Map<string, WorkRow[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    children.set(row.parentId, [...(children.get(row.parentId) ?? []), row]);
  }
  const out: WorkRow[] = [];
  const seen = new Set<string>([root]);
  const queue = [root];
  while (queue.length > 0) {
    for (const child of children.get(queue.pop() as string) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child);
      queue.push(child.id);
    }
  }
  return out;
}

/**
 * What a feature batch did: steps beneath the feature closed or blocked in
 * its window, and whether its rows are still moving.
 *
 * The twenty minutes are the overnight tick's `FEATURE_IDLE_AFTER_MINUTES`,
 * handed in rather than imported so this file stays free of the liveness
 * rules it is read beside.
 */
export function featureWork(
  rows: readonly WorkRow[],
  root: string,
  window: { from: string; to: string },
  now: number,
  idleAfterMinutes: number,
): RunWork {
  const under = beneath(rows, root);
  const done = under.filter(
    (row) => within(row.completedAt, window) || within(row.blockedAt, window),
  ).length;
  const own = rows.find((row) => row.id === root);
  const closed = own?.status === 'done' || own?.status === 'dropped';
  const claimed = under.some((row) => row.status === 'in_progress');
  const touched = Math.max(
    new Date(window.from).getTime(),
    ...[own, ...under].map((row) => (row ? new Date(row.updatedAt).getTime() || 0 : 0)),
  );
  const busy = !closed && (claimed || (now - touched) / 60_000 < idleAfterMinutes);
  return { done, busy };
}

/**
 * What a re-shape did: rows written beneath the feature, or dropped there, in
 * its window.
 *
 * A re-shape of a feature that has already closed writes nothing inside it
 * and raises a new top-level feature whose detail names it instead, so those
 * are counted too: `named` is the top-level rows written in the window whose
 * detail mentions the feature's number.
 */
export function reshapeWork(
  rows: readonly WorkRow[],
  root: string,
  window: { from: string; to: string },
  named: readonly { createdAt: string; detail: string | null }[] = [],
): RunWork {
  const under = beneath(rows, root);
  const written = under.filter(
    (row) => within(row.createdAt, window) || (row.status === 'dropped' && within(row.updatedAt, window)),
  ).length;
  const number = rows.find((row) => row.id === root)?.number ?? null;
  const raised =
    number === null
      ? 0
      : named.filter(
          (row) =>
            within(row.createdAt, window) &&
            new RegExp(`#${number}(?!\\d)`).test(row.detail ?? ''),
        ).length;
  return { done: written + raised };
}

/** What a check-back run did, from the check-backs it was woken for. */
export function checkBackWork(statuses: readonly string[]): RunWork {
  const closed = statuses.filter((status) => status !== 'waiting').length;
  return { done: closed, over: statuses.length > 0 && closed === statuses.length };
}


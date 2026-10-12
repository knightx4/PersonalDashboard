/**
 * The snapshot saved with each goal review and each feature update
 * (plan #1832; plan_updates.snapshot in supabase/migrations/0202, and
 * goals.reviews.snapshot in supabase/migrations-goals/0074).
 *
 * It holds the counts a page was based on, the ids of the steps still open and
 * the due date where there is one, never a step's text. Two snapshots of the
 * same goal or feature can then be compared without keeping the steps
 * themselves: `diffSnapshots` names the steps closed and added between them
 * and a due date that moved.
 *
 * The database writes the snapshot (a before-insert trigger calls
 * plan_feature_snapshot or goals.goal_snapshot when the insert gives none), and
 * this file is the one place that reads it back. Pure.
 */

export type ProgressSnapshot = {
  v: 1;
  open: number;
  done: number;
  total: number;
  blocked: number;
  /** Ids of the steps still open, sorted. */
  openIds: string[];
  /** The goal's own due date as YYYY-MM-DD; null for a feature, or no date. */
  dueOn: string | null;
};

const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

/** A snapshot as the column returns it, or null when it is absent or not one. */
export function parseSnapshot(value: unknown): ProgressSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const open = count(row.open);
  const done = count(row.done);
  const total = count(row.total);
  const blocked = count(row.blocked);
  if (row.v !== 1 || open === null || done === null || total === null || blocked === null) {
    return null;
  }
  if (!Array.isArray(row.openIds) || !row.openIds.every((id) => typeof id === 'string')) {
    return null;
  }
  const dueOn = typeof row.dueOn === 'string' && row.dueOn !== '' ? row.dueOn : null;
  return { v: 1, open, done, total, blocked, openIds: [...(row.openIds as string[])].sort(), dueOn };
}

export type SnapshotDiff = {
  /** Open in the earlier snapshot, gone from the open list in the later one, and counted as done. */
  closed: string[];
  /** Open in the later snapshot and not in the earlier one. */
  added: string[];
  /** The later done count minus the earlier; negative when it fell. */
  doneChange: number;
  /** The later total minus the earlier; negative when steps were taken out. */
  totalChange: number;
  /** Set when the due date differs; either side may be null (a date set or cleared). */
  dueMoved: { from: string | null; to: string | null } | null;
};

/**
 * What changed between two snapshots of the same goal or feature.
 *
 * A step that left the open list was either closed or taken out, and the
 * snapshot keeps no per-step status to tell the two apart, so the split is by
 * counts: up to `doneChange` of the ids that left are named closed, and any
 * beyond that are taken to be dropped. A caller that needs the exact answer
 * reads the steps themselves.
 *
 * `added` is the ids open in the later snapshot but not the earlier one: a
 * step created since, approved since, or reopened.
 */
export function diffSnapshots(earlier: ProgressSnapshot, later: ProgressSnapshot): SnapshotDiff {
  const before = new Set(earlier.openIds);
  const after = new Set(later.openIds);
  const left = earlier.openIds.filter((id) => !after.has(id));
  const added = later.openIds.filter((id) => !before.has(id));
  const doneChange = later.done - earlier.done;
  const closed = left.slice(0, Math.max(doneChange, 0));
  const dueMoved = earlier.dueOn === later.dueOn ? null : { from: earlier.dueOn, to: later.dueOn };
  return { closed, added, doneChange, totalChange: later.total - earlier.total, dueMoved };
}

/** True when nothing differs, so a page can say the goal or feature is as it was. */
export function isUnchanged(diff: SnapshotDiff): boolean {
  return (
    diff.closed.length === 0 &&
    diff.added.length === 0 &&
    diff.doneChange === 0 &&
    diff.totalChange === 0 &&
    diff.dueMoved === null
  );
}

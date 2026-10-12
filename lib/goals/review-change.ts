import { formatDay } from '@/lib/goals/dates';
import { diffSnapshots, isUnchanged, type ProgressSnapshot } from '@/lib/progress-snapshot';

/**
 * What moved on a goal since the review before its latest one (plan #1833),
 * as one line under its status: "Since 8 Oct: 2 steps closed, 1 added, due
 * date moved from 3 Nov to 20 Nov". Built from the two snapshots the reviews
 * carry (plan #1832); a review with no snapshot, which is every one written
 * before then, gives nothing. Pure.
 */

type Dated = { createdAt: string; snapshot: ProgressSnapshot | null };

const steps = (n: number) => `${n} ${n === 1 ? 'step' : 'steps'}`;

function dueText(from: string | null, to: string | null): string {
  if (from && to) return `due date moved from ${formatDay(from)} to ${formatDay(to)}`;
  if (to) return `due date set to ${formatDay(to)}`;
  return `due date ${formatDay(from as string)} removed`;
}

/**
 * `newest` and `previous` are the goal's two newest reviews that carry a
 * snapshot. Null when either is missing.
 */
export function reviewChangeLine(newest: Dated | null, previous: Dated | null): string | null {
  if (!newest?.snapshot || !previous?.snapshot) return null;
  const diff = diffSnapshots(previous.snapshot, newest.snapshot);
  const since = `Since ${formatDay(previous.createdAt.slice(0, 10))}`;
  if (isUnchanged(diff)) return `${since}: nothing has changed.`;
  const parts: string[] = [];
  if (diff.closed.length > 0) parts.push(`${steps(diff.closed.length)} closed`);
  if (diff.added.length > 0) parts.push(`${diff.added.length} added`);
  if (diff.dueMoved) parts.push(dueText(diff.dueMoved.from, diff.dueMoved.to));
  // Counts moved with no open step named, such as steps taken out.
  if (parts.length === 0) {
    parts.push(diff.totalChange < 0 ? `${steps(-diff.totalChange)} taken out` : 'the steps changed');
  }
  return `${since}: ${parts.join(', ')}.`;
}

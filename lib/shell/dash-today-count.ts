import type { DashTodayGroup } from './dash-today';

/*
 * The count on What Dash did today's heading and on Home's fold of it (plan
 * #1937.8), apart from the loader so the client section can import it
 * without the loader's server reads.
 */

/** How many changes Dash made today, across every group. */
export function dashTodayCount(groups: readonly DashTodayGroup[]): number {
  return groups.reduce((sum, group) => sum + group.entries.length, 0);
}

/** "1 change", "12 changes". */
export function changesLabel(count: number): string {
  return `${count} ${count === 1 ? 'change' : 'changes'}`;
}

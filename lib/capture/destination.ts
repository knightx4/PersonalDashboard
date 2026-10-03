/**
 * Where capture says an item went, in words and as a place in the shell.
 *
 * The panel names the destination once an item is filed, beside the nav item
 * it landed on: "Todo · Today", "Goals · Run a half marathon". The first half
 * is the workspace, the second the list or goal inside it. `href` is the
 * workspace's home, which is also the section the shell's column and the
 * phone's dock link to, so the panel can find that row on screen.
 *
 * Pure, so the wording is checked without a browser; finding the row and
 * drawing the name is components/motion/settle.ts.
 */

import { moduleById, type ModuleId } from '@/lib/modules';
import type { CaptureAction } from '@/lib/capture/actions';
import { isCalendarDay, type CaptureDay } from '@/lib/capture/todo';
import type { FiledEntry } from '@/lib/goals/capture';

export type CaptureDestination = {
  module: ModuleId;
  /** The workspace's home: the nav row the item flies to when it is on screen. */
  href: string;
  /** What is shown beside the row, "Todo · Today". */
  name: string;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The day a todo was filed for, the way the chips say it. */
export function todoDayName(day: CaptureDay): string {
  if (day === 'today') return 'Today';
  if (day === 'tomorrow') return 'Tomorrow';
  if (isCalendarDay(day)) {
    const [, month, date] = day.split('-').map(Number);
    return `${date} ${MONTHS[month - 1]}`;
  }
  return 'No day';
}

/**
 * The goal a sentence was filed against: its title when every line went to
 * one goal, a count when they went to several, and the Goals home when
 * nothing matched and the sentence was only kept.
 */
export function goalsPlaceName(entries: readonly FiledEntry[]): string {
  const goals = [...new Set(entries.filter((e) => !e.undone_at).map((e) => e.goal_title))];
  if (goals.length === 0) return 'Home';
  if (goals.length === 1) return goals[0];
  return `${goals.length} goals`;
}

/** Where a filed item went, or null for an action with no workspace. */
export function captureDestination(
  action: CaptureAction,
  filed: { day: CaptureDay; entries?: readonly FiledEntry[] },
): CaptureDestination | null {
  const workspace = moduleById(action.module);
  if (!workspace) return null;
  const place = action.id === 'todo' ? todoDayName(filed.day) : goalsPlaceName(filed.entries ?? []);
  return { module: workspace.id, href: workspace.home, name: `${workspace.label} · ${place}` };
}

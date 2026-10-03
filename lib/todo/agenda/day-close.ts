import { dueDay, todayIn, type Task } from '@/lib/todo/tasks/model';
import { todayEntries } from '@/lib/todo/agenda/today';
import type { AgendaPile } from '@/lib/todo/agenda/merge';

/**
 * The day closing (docs/UI-QUALITY-SPEC.md, Part 8; plan #1556): what the
 * Todo list shows once the last thing due today has been ticked.
 *
 * PURE. The page reads the tasks finished today (loadDoneToday in
 * lib/todo/tasks/load.ts), keeps the ones that were due by today, and the day
 * is closed when nothing is left under Overdue and Today and at least one of
 * those was finished. A day with nothing due and nothing done is a quiet day,
 * not a closed one, and finishing something undated does not close it either.
 */

export interface DoneTodayTask {
  id: string;
  title: string;
}

/**
 * The tasks finished today that were due today or earlier, most recent
 * first, so the pile has the last one ticked on top.
 */
export function doneToday(
  tasks: readonly Task[],
  timezone: string,
  now: Date = new Date(),
): DoneTodayTask[] {
  const today = todayIn(timezone, now);
  return tasks
    .filter((task) => {
      if (task.status !== 'done' || task.parentId !== null || !task.completedAt) return false;
      if (todayIn(timezone, new Date(task.completedAt)) !== today) return false;
      const due = dueDay(task, timezone);
      return due !== null && due <= today;
    })
    .sort((a, b) => Date.parse(b.completedAt!) - Date.parse(a.completedAt!))
    .map(({ id, title }) => ({ id, title }));
}

/** Whether the day is closed: nothing left due by today, and something done. */
export function dayClosed(piles: readonly AgendaPile[], done: readonly DoneTodayTask[]): boolean {
  return done.length > 0 && todayEntries(piles).length === 0;
}

/** The line under the closed pile, naming the count. */
export function dayClosedLine(count: number): string {
  if (count === 1) return 'You finished the one thing due today.';
  return `You finished all ${count} things due today.`;
}

import { formatReading } from '@/lib/goals/readings';

/**
 * Home's Done today (plan #1740): what you finished or got further with
 * since midnight, from Todo and from your goals together. A task ticked, a
 * goal step closed (by you, by a line in the "What did you do?" box, or by
 * capture) and progress logged on a step or a goal each make one line,
 * newest first.
 *
 * PURE. The rows are read by lib/goals/done-today-store.ts and the todo
 * loader; this only joins and orders them. The day's sigil keeps its own
 * rule (lib/todo/agenda/day-close.ts), which counts only tasks due by today.
 */

/** The most lines Home shows; the rest are counted under them. */
export const DONE_TODAY_SHOWN = 8;

/** A goal step closed today, with the goal it sits under. */
export type ClosedStepToday = {
  id: string;
  title: string;
  goalId: string;
  goalTitle: string;
  closedAt: string;
};

/** Progress logged today on a step, or on a goal when `stepId` is null. */
export type ProgressToday = {
  id: string;
  stepId: string | null;
  stepTitle: string | null;
  goalId: string;
  goalTitle: string;
  text: string;
  quantity: number | null;
  unit: string | null;
  createdAt: string;
};

/** A task ticked today. */
export type TaskDoneToday = { id: string; title: string; completedAt: string };

export type DoneTodayLine = {
  key: string;
  kind: 'task' | 'step' | 'progress';
  /** What was done. */
  title: string;
  /** Where it counts: the goal, the step progress was logged on, or Todo. */
  detail: string;
  href: string;
  at: string;
};

export type DoneTodayList = { lines: DoneTodayLine[]; more: number };

function stepHref(goalId: string, stepId: string): string {
  return `/goals/${goalId}/s/${stepId}`;
}

/** What a progress line says was done: the words, or the amount when there are none. */
function progressTitle(entry: ProgressToday): string {
  const said = entry.text.trim();
  if (said || entry.quantity === null) return said;
  return formatReading(entry.quantity, entry.unit);
}

/**
 * The day's lines, newest first, cut to DONE_TODAY_SHOWN. Progress on a step
 * that was also closed today is left out: the close already says it.
 */
export function doneTodayList(
  tasks: readonly TaskDoneToday[],
  steps: readonly ClosedStepToday[],
  progress: readonly ProgressToday[],
  shown: number = DONE_TODAY_SHOWN,
): DoneTodayList {
  const closed = new Set(steps.map((s) => s.id));
  const lines: DoneTodayLine[] = [
    ...tasks.map((task) => ({
      key: `task:${task.id}`,
      kind: 'task' as const,
      title: task.title,
      detail: 'Todo',
      href: '/todo',
      at: task.completedAt,
    })),
    ...steps.map((step) => ({
      key: `step:${step.id}`,
      kind: 'step' as const,
      title: step.title,
      detail: step.goalTitle,
      href: stepHref(step.goalId, step.id),
      at: step.closedAt,
    })),
    ...progress
      .filter((entry) => !(entry.stepId && closed.has(entry.stepId)))
      .map((entry) => ({
        key: `progress:${entry.id}`,
        kind: 'progress' as const,
        title: progressTitle(entry),
        detail: entry.stepTitle ?? entry.goalTitle,
        href: entry.stepId ? stepHref(entry.goalId, entry.stepId) : `/goals/${entry.goalId}`,
        at: entry.createdAt,
      })),
  ]
    .filter((line) => line.title.trim() !== '')
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return { lines: lines.slice(0, shown), more: Math.max(0, lines.length - shown) };
}

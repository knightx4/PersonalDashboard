import { HoursView } from '@/app/goals/hours/hours-view';
import { hoursPage, type HoursMetric } from '@/lib/goals/hours';
import { addDays } from '@/lib/todo/tasks/model';

/**
 * The Hours page (/goals/hours, goals 0089) drawn from fixtures for the
 * gallery: twelve weeks of applying, cleaning and AI training, as of
 * Wednesday 28 October 2026, through hoursPage as the page's own read is.
 */

const TODAY = '2026-10-28';
const FIRST_MONDAY = '2026-08-10';

/** Hours on each weekday of each week from FIRST_MONDAY, a row a week, Monday first. */
function logged(weeks: readonly (readonly number[])[]): HoursMetric['days'] {
  return weeks.flatMap((week, w) =>
    week.flatMap((hours, d) => (hours > 0 ? [{ day: addDays(FIRST_MONDAY, w * 7 + d), hours }] : [])),
  );
}

const METRICS: HoursMetric[] = [
  {
    id: 'h-applying',
    name: 'Applying',
    goalId: 'g-role',
    goalTitle: 'Land your next role',
    target: 10,
    targetHigh: 15,
    days: logged([
      [2, 1.5, 0, 2, 1], [3, 2, 2.5, 2, 0], [1, 0, 0, 1.5, 0], [2.5, 3, 2, 2, 1.5],
      [2, 2, 3, 2.5, 2], [0, 1, 2, 2, 1], [3, 3, 2.5, 2, 2], [2, 2.5, 3, 2, 3, 1],
      [2, 2, 2, 2.5, 1.5], [3, 2, 0, 2, 2], [2.5, 3, 3, 2, 2], [2, 1.5, 0.5],
    ]),
  },
  {
    id: 'h-cleaning',
    name: 'Cleaning',
    goalId: 'g-home',
    goalTitle: 'Make the apartment clean and livable',
    target: 10,
    targetHigh: 15,
    days: logged([
      [1, 0, 1, 0, 2], [0, 1, 0, 1, 1, 3], [2, 2, 1, 1, 2], [1, 1, 1, 0, 1],
      [0, 0, 2, 1, 0, 4], [2, 1, 2, 2, 2], [1, 2, 2, 3, 2], [2, 2, 2, 2, 2],
      [3, 2, 3, 2, 3], [2, 2, 2, 2, 2.5], [2.5, 3, 2, 3, 2], [3, 2.5],
    ]),
  },
  {
    id: 'h-ai',
    name: 'AI training',
    goalId: 'g-ai',
    goalTitle: 'Earn steadily from AI training work',
    target: 10,
    targetHigh: 20,
    days: logged([
      [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 2, 3, 0], [3, 4, 2, 3, 3],
      [4, 3, 4, 2, 3], [2, 3, 0, 3, 4], [4, 4, 3, 3, 2], [3, 0, 4, 4, 3],
      [2, 3, 3, 2, 2], [4, 4, 3, 4, 3], [3, 3, 4, 2, 3], [4, 3, 3.5],
    ]),
  },
];

export function GoalHoursSurface() {
  return <HoursView page={hoursPage(METRICS, TODAY)} />;
}

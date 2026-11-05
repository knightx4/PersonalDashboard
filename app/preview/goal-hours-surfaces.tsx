'use client';

import { useEffect } from 'react';
import { ToastProvider, useToast } from '@/components/ui/toast';
import type { OpenDay } from '@/app/goals/hours/day-by-day';
import { HoursView } from '@/app/goals/hours/hours-view';
import { LogHours } from '@/app/goals/hours/log-hours';
import { earliestProgressDay } from '@/lib/goals/capture';
import { hoursPage, type HoursEntry, type HoursMetric } from '@/lib/goals/hours';
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

/** Monday 26 October's entries, as the day's drawer lists them (plan #2907.2). */
const DAY_ENTRIES: HoursEntry[] = [
  {
    id: 'e-1',
    goalId: 'g-role',
    goalTitle: 'Land your next role',
    stepTitle: 'Apply to five platform engineering roles a week',
    hours: 1.5,
    note: 'applied to the senior platform role at Monzo and rewrote the cover letter for it',
  },
  {
    id: 'e-2',
    goalId: 'g-role',
    goalTitle: 'Land your next role',
    stepTitle: null,
    hours: 0.5,
    note: 'applied 30 min',
  },
  {
    id: 'e-3',
    goalId: 'g-home',
    goalTitle: 'Make the apartment clean and livable',
    stepTitle: 'Clear the hallway',
    hours: 3,
    note: 'cleaned 3h',
  },
  {
    id: 'e-4',
    goalId: 'g-ai',
    goalTitle: 'Earn steadily from AI training work',
    stepTitle: null,
    hours: 4,
    note: 'AI training 4h',
  },
];

/** The days each drawn state of the drawer opens on. */
const OPEN_DAYS = {
  entries: { day: '2026-10-26', state: { status: 'ready', entries: DAY_ENTRIES } },
  // Change pressed on the first entry: its hours, day and note in place (plan #2907.3).
  change: {
    day: '2026-10-26',
    state: { status: 'ready', entries: DAY_ENTRIES },
    drawn: { 'e-1': { editing: true } },
  },
  // Undo pressed on the half hour of applying: gone from the list, the toast offering it back.
  undone: {
    day: '2026-10-26',
    state: { status: 'ready', entries: DAY_ENTRIES.filter((entry) => entry.id !== 'e-2') },
  },
  // An Undo that failed says so under its own row.
  rowError: {
    day: '2026-10-26',
    state: { status: 'ready', entries: DAY_ENTRIES },
    drawn: { 'e-3': { error: 'That could not be undone. Try again.' } },
  },
  empty: { day: '2026-10-25', state: { status: 'ready', entries: [] }, logOpen: true },
  loading: { day: '2026-10-26', state: { status: 'loading' } },
  error: {
    day: '2026-10-26',
    state: { status: 'error', message: 'The hours for this day could not be read.' },
  },
} satisfies Record<string, OpenDay>;

function UndoneToast() {
  const toast = useToast();
  useEffect(() => {
    toast({
      text: '0.5 h off Land your next role',
      undo: () => undefined,
      undoLabel: 'Restore',
      duration: 600_000,
    });
  }, [toast]);
  return null;
}

export function GoalHoursSurface({
  logOpen = false,
  day,
}: {
  logOpen?: boolean;
  /** A day's drawer drawn open, in one of its states. */
  day?: keyof typeof OPEN_DAYS;
}) {
  const body = (
    // With a drawer open the page is held to a phone's height and the sheet
    // drawn inside it, so the full-page shot shows what the window shows.
    <div className={day ? 'relative h-[52rem] space-y-4 overflow-hidden' : 'space-y-4'}>
      <LogHours today={TODAY} earliest={earliestProgressDay(TODAY)} initialOpen={logOpen} />
      <HoursView
        page={hoursPage(METRICS, TODAY)}
        earliest={earliestProgressDay(TODAY)}
        openDay={day ? { ...OPEN_DAYS[day], contained: true } : undefined}
      />
    </div>
  );
  return day === 'undone' ? (
    <ToastProvider>
      {body}
      <UndoneToast />
    </ToastProvider>
  ) : (
    body
  );
}

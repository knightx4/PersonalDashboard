/**
 * The days Later can be set to (plan #1844, #1957.2): Tomorrow, This weekend,
 * Next week, Next month, or a day picked. Shared by everything that puts a
 * thing off (a todo, a goal step, a raise, an Inbox row), so each offers the
 * same choices and means the same by them. components/inbox/snooze-menu.tsx
 * draws them. Pure, so the dates are tested without a clock; each write is
 * the caller's.
 */

export const SNOOZE_CHOICES = ['tomorrow', 'weekend', 'next_week', 'next_month'] as const;
export type SnoozeChoice = (typeof SNOOZE_CHOICES)[number];

export const SNOOZE_LABELS: Record<SnoozeChoice, string> = {
  tomorrow: 'Tomorrow',
  weekend: 'This weekend',
  next_week: 'Next week',
  next_month: 'Next month',
};

/** The fifth choice, which opens a date field rather than naming a day. */
export const PICK_A_DAY = 'Pick a day';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The next given weekday (0 Sunday to 6 Saturday) after today, a week on if today is one. */
function coming(today: string, weekday: number): string {
  const until = (weekday - new Date(`${today}T00:00:00Z`).getUTCDay() + 7) % 7;
  return addDays(today, until === 0 ? 7 : until);
}

/**
 * The day a choice means, from `today` (YYYY-MM-DD in the account's zone):
 * tomorrow is the next day, this weekend the coming Saturday, next week the
 * coming Monday (each a week on when today is that day), next month the first
 * of next month, and a picked day is itself. A picked day that is not a real
 * date or is not after today gives null, since Later must end in the future.
 */
export function snoozeDay(choice: string, today: string): string | null {
  if (choice === 'tomorrow') return addDays(today, 1);
  if (choice === 'weekend') return coming(today, 6);
  if (choice === 'next_week') return coming(today, 1);
  if (choice === 'next_month') {
    const [year, month] = today.split('-').map(Number);
    return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  }
  if (!DAY.test(choice)) return null;
  if (Number.isNaN(Date.parse(`${choice}T00:00:00Z`))) return null;
  if (new Date(`${choice}T00:00:00Z`).toISOString().slice(0, 10) !== choice) return null;
  return choice > today ? choice : null;
}

/** The zone's offset from UTC at an instant, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The instant a calendar day begins in a zone: when a snooze to that day ends. */
export function dayStartIn(day: string, timeZone: string): Date {
  const midnightUtc = Date.parse(`${day}T00:00:00Z`);
  const first = midnightUtc - offsetAt(midnightUtc, timeZone);
  return new Date(midnightUtc - offsetAt(first, timeZone));
}

/**
 * How exact a goal's date is (plan #1839, feature #1838).
 *
 * A goal's date is a day, a month, a quarter, a half year or a year. The
 * stored date (goals.items.due_on) is always the last day of the period, so
 * every sort and comparison on it keeps working, and goals.items.due_precision
 * (goals 0072) says what that date is the end of. Existing dates are days.
 *
 * Overdue is therefore the same test at every precision: the stored date is
 * before today. A goal due in Q2 2027 is stored as 2027-06-30 and is not late
 * until 1 July. Pure; calendar dates are read in UTC so no zone moves a day.
 */

export const DUE_PRECISIONS = ['day', 'month', 'quarter', 'half', 'year'] as const;
export type DuePrecision = (typeof DUE_PRECISIONS)[number];

export const DEFAULT_DUE_PRECISION: DuePrecision = 'day';

export function isDuePrecision(value: unknown): value is DuePrecision {
  return typeof value === 'string' && (DUE_PRECISIONS as readonly string[]).includes(value);
}

/** The precision a stored value means; anything unknown reads as a day. */
export function toDuePrecision(value: unknown): DuePrecision {
  return isDuePrecision(value) ? value : DEFAULT_DUE_PRECISION;
}

function parts(isoDate: string): { year: number; month: number } {
  const [year, month] = isoDate.split('-').map(Number);
  return { year, month };
}

function iso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The date to store for the period that holds `isoDate`: itself for a day, the
 * last day of its month, quarter, half year or year otherwise.
 */
export function periodEnd(isoDate: string, precision: DuePrecision): string {
  const { year, month } = parts(isoDate);
  switch (precision) {
    case 'day':
      return isoDate;
    case 'month':
      return iso(year, month, lastDayOfMonth(year, month));
    case 'quarter': {
      const last = Math.ceil(month / 3) * 3;
      return iso(year, last, lastDayOfMonth(year, last));
    }
    case 'half': {
      const last = month <= 6 ? 6 : 12;
      return iso(year, last, lastDayOfMonth(year, last));
    }
    case 'year':
      return iso(year, 12, 31);
  }
}

/** Whether a stored date is already the end of its period, as the database requires. */
export function isPeriodEnd(isoDate: string, precision: DuePrecision): boolean {
  return periodEnd(isoDate, precision) === isoDate;
}

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const DAY_YEAR = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
 * A goal's date as it is shown, without the "by": "3 Oct", "Mar 2027",
 * "Q2 2027", "H1 2027", "2027". A day drops its year when it falls in
 * `currentYear`; leave that out to always show the year.
 */
export function formatDue(
  isoDate: string,
  precision: DuePrecision = DEFAULT_DUE_PRECISION,
  currentYear?: number,
): string {
  const { year, month } = parts(isoDate);
  const at = new Date(`${isoDate}T00:00:00Z`);
  switch (precision) {
    case 'day':
      return (currentYear === year ? DAY : DAY_YEAR).format(at);
    case 'month':
      return MONTH.format(at);
    case 'quarter':
      return `Q${Math.ceil(month / 3)} ${year}`;
    case 'half':
      return `H${month <= 6 ? 1 : 2} ${year}`;
    case 'year':
      return String(year);
  }
}

/** "by Mar 2027", "by Q2 2027", "by 2027", "by 3 Oct". */
export function formatDueBy(
  isoDate: string,
  precision: DuePrecision = DEFAULT_DUE_PRECISION,
  currentYear?: number,
): string {
  return `by ${formatDue(isoDate, precision, currentYear)}`;
}

/**
 * Overdue once the whole period has passed: the stored date, which is the
 * period's last day, is before today. A goal with no date is never overdue.
 * The precision does not change the test; it is taken so a caller reads as
 * what it means.
 */
export function isDueOverdue(
  dueOn: string | null | undefined,
  _precision: DuePrecision,
  today: string,
): boolean {
  return dueOn != null && dueOn < today;
}

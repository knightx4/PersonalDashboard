/**
 * Reading a cron expression for the Routines pages: how often it fires, in
 * words, and when it next fires.
 *
 * Only the five-field form pg_cron takes, in UTC: numbers, `*`, lists, ranges
 * and steps. That covers every schedule the app writes. Anything else parses
 * as null and the page shows the expression as it is.
 *
 * Pure, so the rules are tested without a clock.
 */

type Field = ReadonlySet<number>;

export type Cron = {
  minute: Field;
  hour: Field;
  dayOfMonth: Field;
  month: Field;
  dayOfWeek: Field;
  /** Whether each of the day fields was `*`, which changes how they combine. */
  anyDayOfMonth: boolean;
  anyDayOfWeek: boolean;
};

const BOUNDS: readonly [number, number][] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

function parseField(text: string, [min, max]: [number, number]): Set<number> | null {
  const values = new Set<number>();
  for (const part of text.split(',')) {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!match) return null;
    const [, range, stepText] = match;
    const step = stepText ? Number(stepText) : 1;
    if (step < 1) return null;
    let from = min;
    let to = max;
    if (range !== '*') {
      const [a, b] = range.split('-').map(Number);
      from = a;
      to = b ?? (stepText ? max : a);
    }
    if (from < min || to > max || from > to) return null;
    for (let value = from; value <= to; value += step) values.add(value);
  }
  return values;
}

export function parseCron(expression: string): Cron | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const parsed = fields.map((field, i) => parseField(field, BOUNDS[i]));
  if (parsed.some((field) => field === null)) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parsed as Set<number>[];
  // Sunday is both 0 and 7.
  if (dayOfWeek.has(7)) dayOfWeek.add(0);
  return {
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek,
    anyDayOfMonth: fields[2] === '*',
    anyDayOfWeek: fields[4] === '*',
  };
}

function matchesDay(cron: Cron, date: Date): boolean {
  const dom = cron.dayOfMonth.has(date.getUTCDate());
  const dow = cron.dayOfWeek.has(date.getUTCDay());
  // Cron's own rule: when both day fields are restricted, either may match.
  if (!cron.anyDayOfMonth && !cron.anyDayOfWeek) return dom || dow;
  return dom && dow;
}

/**
 * The first minute after `after` the expression fires, as an ISO instant, or
 * null when it does not fire within `withinDays` (a yearly job, mostly).
 */
export function nextFire(expression: string, after: number, withinDays = 400): string | null {
  const cron = parseCron(expression);
  if (!cron) return null;
  const start = new Date(after);
  start.setUTCSeconds(0, 0);
  start.setUTCMinutes(start.getUTCMinutes() + 1);
  const limit = after + withinDays * 86_400_000;
  const at = start;
  while (at.getTime() <= limit) {
    if (!cron.month.has(at.getUTCMonth() + 1) || !matchesDay(cron, at)) {
      at.setUTCHours(0, 0, 0, 0);
      at.setUTCDate(at.getUTCDate() + 1);
      continue;
    }
    if (!cron.hour.has(at.getUTCHours())) {
      at.setUTCMinutes(0);
      at.setUTCHours(at.getUTCHours() + 1);
      continue;
    }
    if (cron.minute.has(at.getUTCMinutes())) return at.toISOString();
    at.setUTCMinutes(at.getUTCMinutes() + 1);
  }
  return null;
}

/** How often the expression fires, in words: "Every 10 minutes", "Every week". */
export function describeCron(expression: string): string {
  const cron = parseCron(expression);
  if (!cron) return expression;
  const everyDay = cron.anyDayOfMonth && cron.anyDayOfWeek && cron.month.size === 12;
  const minutes = cron.minute.size;
  const hours = cron.hour.size;

  if (hours === 24 && everyDay) {
    if (minutes === 1) return 'Every hour';
    const sorted = [...cron.minute].sort((a, b) => a - b);
    const gap = sorted[1] - sorted[0];
    const even = sorted.every((m, i) => i === 0 || m - sorted[i - 1] === gap) && gap * minutes === 60;
    return even ? `Every ${gap} minutes` : `${minutes} times an hour`;
  }
  if (minutes !== 1) return expression;
  if (everyDay) return hours === 1 ? 'Every day' : `${hours} times a day`;
  if (hours !== 1) return expression;
  if (cron.anyDayOfMonth && cron.month.size === 12) {
    const days = new Set([...cron.dayOfWeek].map((d) => d % 7)).size;
    return days === 1 ? 'Every week' : `${days} days a week`;
  }
  if (cron.anyDayOfWeek && cron.month.size === 12 && cron.dayOfMonth.size === 1) return 'Every month';
  if (cron.anyDayOfWeek && cron.month.size === 1 && cron.dayOfMonth.size === 1) return 'Once a year';
  return expression;
}

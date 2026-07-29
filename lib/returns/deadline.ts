/**
 * Shared helpers for return deadlines shown in the tracker and inventory.
 */

export const DUE_SOON_DAYS = 14;

/** Calendar-day difference between two YYYY-MM-DD strings (to - from). */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function deadlineLabel(daysLeft: number, deadline: string): string {
  if (daysLeft < 0) {
    const overdue = Math.abs(daysLeft);
    if (overdue === 1) return '1 day overdue';
    return `${overdue} days overdue`;
  }
  if (daysLeft === 0) return 'Due today';
  if (daysLeft === 1) return '1 day left';
  if (daysLeft <= 7) return `${daysLeft} days left`;
  return `Until ${deadline}`;
}

export function isDueSoon(daysLeft: number): boolean {
  return daysLeft >= 0 && daysLeft <= DUE_SOON_DAYS;
}

export function isOverdue(daysLeft: number): boolean {
  return daysLeft < 0;
}

/**
 * Effective return window for a merchant.
 * An override row wins (even when days is null); otherwise the seeded default.
 */
export function effectiveReturnWindowDays(input: {
  seededDays: number | null;
  override: { returnWindowDays: number | null } | null;
}): number | null {
  if (input.override) return input.override.returnWindowDays;
  return input.seededDays;
}

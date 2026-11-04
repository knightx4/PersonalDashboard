import { parseDollarsToCents } from '@/lib/money';

/**
 * Reading what the person types into a balance or a date (plan #2593.5),
 * shared by the popover, the add-account form and the import preview. Each
 * answers with the sentence to show under the field when it cannot read it.
 */

export function parseBalance(
  input: string,
): { ok: true; cents: number } | { ok: false; error: string } {
  if (input.trim() === '') return { ok: false, error: 'Type the balance, such as 1,240.50.' };
  try {
    return { ok: true, cents: parseDollarsToCents(input) };
  } catch {
    return { ok: false, error: 'Type the balance as dollars and cents, such as 1,240.50.' };
  }
}

/** A balance that may be left empty: null then. */
export function parseOptionalBalance(
  input: string | null | undefined,
): { ok: true; cents: number | null } | { ok: false; error: string } {
  if (!input || input.trim() === '') return { ok: true, cents: null };
  return parseBalance(input);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseDay(input: string): { ok: true; day: string } | { ok: false; error: string } {
  const day = input.trim();
  if (!DAY.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`)))
    return { ok: false, error: 'Pick the day the balance is from.' };
  return { ok: true, day };
}

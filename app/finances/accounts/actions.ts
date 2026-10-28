'use server';

import { revalidatePath } from 'next/cache';
import { createClient, requireUser } from '@/lib/auth/server';
import { addBalanceReading } from '@/lib/finances/import/store';
import { parseBalance, parseDay } from '@/lib/finances/import/input';

export type ReadingResult = { ok: true } | { ok: false; error: string };

/**
 * A new balance for an account kept by hand or by statement (plan #2593.5),
 * from the popover on its page. A linked account or a Goals loan is refused.
 */
// latency: pending
export async function addReading(
  accountId: string,
  balance: string,
  readOn: string,
): Promise<ReadingResult> {
  const user = await requireUser();
  const cents = parseBalance(balance);
  if (!cents.ok) return cents;
  const day = parseDay(readOn);
  if (!day.ok) return day;
  try {
    const saved = await addBalanceReading(
      await createClient(),
      user.id,
      accountId,
      cents.cents,
      day.day,
    );
    if (!saved) return { ok: false, error: 'This account takes its balance from elsewhere.' };
  } catch (error) {
    console.error('Adding a balance failed', error);
    return { ok: false, error: 'The balance could not be saved. Try again.' };
  }
  revalidatePath('/finances/accounts');
  revalidatePath(`/finances/accounts/${accountId}`);
  revalidatePath('/finances/settings');
  return { ok: true };
}

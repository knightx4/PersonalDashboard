'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/server';
import { insertLevel3Aim } from '@/lib/learn/aims-store';
import { createLearnClient } from '@/lib/learn/auth/server';

/**
 * The ready-made Level 3 goal in one press (plan #906), offered on Subjects
 * since Learn's Goals tab went (plan #1491). The database makes it a goal in
 * the Learn area on /goals as it is saved (goals 0066). It is a list rather
 * than something to place, so nothing here reaches a model.
 */

export type Level3State = { error?: string; done?: number };

// latency: pending
export async function addLevel3Goal(): Promise<Level3State> {
  const user = await requireUser();
  try {
    const result = await insertLevel3Aim(await createLearnClient(), user.id);
    if (result === 'already') return { error: 'You already have the Level 3 goal.' };
  } catch {
    return { error: 'The goal could not be saved. Try again.' };
  }
  revalidatePath('/learn/know');
  revalidatePath('/goals', 'layout');
  return { done: Date.now() };
}

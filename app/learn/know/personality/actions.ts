'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createLearnClient } from '@/lib/learn/auth/server';
import { saveBigFiveResult } from '@/lib/learn/personality/store';
import type { BigFiveResult } from '@/lib/learn/personality/model';
import { todayIn } from '@/lib/todo/tasks/model';

export type SaveBigFiveState = { result: BigFiveResult } | { error: string };

/**
 * Score and keep a finished Big Five test (plan #1632). Called once, with
 * all 50 answers: the page holds them until the last, so leaving halfway
 * saves nothing.
 */
// latency: pending
export async function saveBigFiveAction(answers: number[]): Promise<SaveBigFiveState> {
  const user = await requireUser();
  try {
    const [learn, settings] = await Promise.all([
      createLearnClient(),
      loadAccountSettings(user.id),
    ]);
    const result = await saveBigFiveResult(learn, user.id, answers, todayIn(settings.timezone));
    revalidatePath('/learn/know');
    return { result };
  } catch (error) {
    console.error('[learn personality] save', error instanceof Error ? error.message : error);
    return { error: 'Your answers could not be saved. They are still here; try again.' };
  }
}

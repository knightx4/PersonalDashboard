'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { setContextStatus } from '@/lib/goals/context-store';

/**
 * Keep or dismiss what Claude found in another module for a goal
 * (lib/goals/context.ts). Returns a sentence to show rather than throwing.
 */

export type ContextActionState = { error?: string; done?: number };

const Id = z.string().uuid();
const Status = z.enum(['kept', 'dismissed']);

// latency: pending
export async function setContextStatusAction(
  _prev: ContextActionState,
  form: FormData,
): Promise<ContextActionState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  const status = Status.safeParse(form.get('status'));
  if (!id.success || !status.success) return { error: 'Could not tell which one that was.' };
  try {
    const changed = await setContextStatus(await createGoalsClient(), id.data, status.data);
    if (!changed) return { error: 'That is no longer on the goal. Reload to see it.' };
  } catch {
    return { error: status.data === 'kept' ? 'Could not keep it. Try again.' : 'Could not dismiss it. Try again.' };
  }
  revalidatePath('/goals', 'layout');
  return { done: Date.now() };
}

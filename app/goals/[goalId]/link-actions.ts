'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { linkTarget, unlinkTarget } from '@/lib/goals/links-store';

/**
 * Link a goal to a Learn aim or the job search, and unlink it (plan #931).
 * These write goals.links only; Learn and the job search are read, never
 * written. The history is written by the database.
 */

export type LinkActionState = { error?: string; done?: number };

const Id = z.string().uuid();

function saved(): LinkActionState {
  revalidatePath('/goals', 'layout');
  return { done: Date.now() };
}

// latency: pending
export async function linkAimAction(
  _prev: LinkActionState,
  form: FormData,
): Promise<LinkActionState> {
  const user = await requireUser();
  const goalId = Id.safeParse(form.get('goalId'));
  if (!goalId.success) return { error: 'Could not tell which goal that was.' };
  const aimId = Id.safeParse(form.get('aimId'));
  if (!aimId.success) return { error: 'Pick a Learn goal to link.' };
  try {
    const linked = await linkTarget(await createGoalsClient(), user.id, goalId.data, 'aim', aimId.data);
    if (!linked) return { error: 'That Learn goal could not be linked. Reload to see what is there.' };
  } catch {
    return { error: 'The link could not be saved. Try again.' };
  }
  return saved();
}

// latency: pending
export async function linkJobSearchAction(form: FormData): Promise<LinkActionState> {
  const user = await requireUser();
  const goalId = Id.safeParse(form.get('goalId'));
  if (!goalId.success) return { error: 'Could not tell which goal that was.' };
  try {
    const linked = await linkTarget(await createGoalsClient(), user.id, goalId.data, 'job_search', null);
    if (!linked) return { error: 'That goal is no longer on the page.' };
  } catch {
    return { error: 'The link could not be saved. Try again.' };
  }
  return saved();
}

// latency: pending
export async function unlinkAction(form: FormData): Promise<LinkActionState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which link that was.' };
  try {
    const removed = await unlinkTarget(await createGoalsClient(), id.data);
    if (!removed) return { error: 'That link has already gone. Reload to see it.' };
  } catch {
    return { error: 'The link could not be removed. Try again.' };
  }
  return saved();
}

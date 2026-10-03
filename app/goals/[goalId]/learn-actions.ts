'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { AIM_DEPTHS, type AimDepth } from '@/lib/learn/aims';
import { updateAim } from '@/lib/learn/aims-store';
import { createLearnClient } from '@/lib/learn/auth/server';

/**
 * How well you want to know a goal in the Learn area (plan #1491), set from
 * the goal's page now that Learn has no Goals tab. Only the depth is written
 * here: the goal's title and done-when are its aim's name and line, carried
 * across by the database (goals 0066), and a depth change places nothing
 * again, so nothing here reaches a model.
 */

export type LearnDepthState = { error?: string; done?: number };

const AimId = z.string().uuid();
const Depth = z.enum(AIM_DEPTHS as [AimDepth, ...AimDepth[]]);

// latency: pending
export async function setLearnDepth(
  _prev: LearnDepthState,
  form: FormData,
): Promise<LearnDepthState> {
  await requireUser();
  const id = AimId.safeParse(form.get('aimId'));
  if (!id.success) return { error: 'Could not tell which learning goal that was.' };
  const depth = Depth.safeParse(form.get('depth'));
  if (!depth.success) return { error: 'Pick familiar, solid or deep.' };
  try {
    const changed = await updateAim(await createLearnClient(), id.data, { depth: depth.data });
    if (!changed) return { error: 'That learning goal is no longer active.' };
  } catch {
    return { error: 'The change could not be saved. Try again.' };
  }
  revalidatePath('/goals', 'layout');
  return { done: Date.now() };
}

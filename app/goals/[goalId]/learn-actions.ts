'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { AIM_DEPTHS, type AimDepth } from '@/lib/learn/aims';
import { updateAim } from '@/lib/learn/aims-store';
import { createLearnClient } from '@/lib/learn/auth/server';
import { GOAL_KINDS } from '@/lib/learn/goal-kind';
import { setSubjectKind } from '@/lib/learn/goal-kind-store';

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

/**
 * What kind of subject the goal points at (plan #2247.2; on the subject since
 * #2302.2), changed from the goal's page. The kind decides which sources the
 * subject's preparation tries, and a kind the person sets is kept against the
 * classify step. Nothing here reaches a model.
 */
export type LearnKindState = { error?: string; done?: number };

const Kind = z.enum(GOAL_KINDS);
const SubjectId = z.string().uuid();

// latency: pending
export async function setLearnKind(
  _prev: LearnKindState,
  form: FormData,
): Promise<LearnKindState> {
  await requireUser();
  const id = SubjectId.safeParse(form.get('subjectId'));
  if (!id.success) return { error: 'Could not tell which subject that was.' };
  const kind = Kind.safeParse(form.get('kind'));
  if (!kind.success) return { error: 'Pick one of the kinds listed.' };
  try {
    const changed = await setSubjectKind(await createLearnClient(), id.data, kind.data);
    if (!changed) return { error: 'That subject is no longer there.' };
  } catch {
    return { error: 'The change could not be saved. Try again.' };
  }
  revalidatePath('/goals', 'layout');
  return { done: Date.now() };
}

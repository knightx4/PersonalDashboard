'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { parseAimFields, type AimFields } from '@/lib/learn/aims';
import {
  archiveAim,
  insertAim,
  insertLevel3Aim,
  rewordsAim,
  updateAim,
} from '@/lib/learn/aims-store';
import { placeAimsAfterResponse } from '@/lib/learn/areas/place-aim';

/**
 * The Goals page's writes (plan #897): add a goal, add the Level 3 goal in one
 * press, change a goal's wording or depth, and archive one. Adding or
 * rewording an open goal places it in the area grid after the response (#898).
 *
 * Each returns a sentence to show rather than throwing, so a refused write
 * leaves the page standing with the reason beside the control.
 */

export type GoalActionState = { error?: string; done?: number };

const AimId = z.string().uuid();

const GOALS_PATH = '/learn/goals';

// latency: pending
export async function addGoal(_prev: GoalActionState, form: FormData): Promise<GoalActionState> {
  const user = await requireUser();
  const parsed = parseAimFields((key) => form.get(key));
  if (!parsed.ok) return { error: parsed.error };

  try {
    const supabase = await createLearnClient();
    await insertAim(supabase, user.id, parsed.fields as AimFields);
    // Into a field once the response has gone (#898); the page checks back.
    placeAimsAfterResponse(supabase, user.id);
  } catch {
    return { error: 'The goal could not be saved. Try again.' };
  }
  revalidatePath(GOALS_PATH);
  // A new number each time, so the form can tell one save from the next.
  return { done: Date.now() };
}

// latency: pending
export async function addLevel3Goal(): Promise<GoalActionState> {
  const user = await requireUser();
  try {
    const supabase = await createLearnClient();
    const result = await insertLevel3Aim(supabase, user.id);
    if (result === 'already') return { error: 'You already have the Level 3 goal.' };
  } catch {
    return { error: 'The goal could not be saved. Try again.' };
  }
  revalidatePath(GOALS_PATH);
  return { done: Date.now() };
}

/** An edit sends only the field that changed: the name, the line or the depth. */
// latency: pending
export async function editGoal(_prev: GoalActionState, form: FormData): Promise<GoalActionState> {
  const user = await requireUser();
  const id = AimId.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which goal that was.' };
  const parsed = parseAimFields((key) => form.get(key), { partial: true });
  if (!parsed.ok) return { error: parsed.error };
  if (Object.keys(parsed.fields).length === 0) return {};

  try {
    const supabase = await createLearnClient();
    const changed = await updateAim(supabase, id.data, parsed.fields);
    if (!changed) return { error: 'That goal is no longer in your list.' };
    // A new name or line cleared the placement; place it again.
    if (rewordsAim(parsed.fields)) placeAimsAfterResponse(supabase, user.id);
  } catch {
    return { error: 'The change could not be saved. Try again.' };
  }
  revalidatePath(GOALS_PATH);
  return { done: Date.now() };
}

// latency: pending
export async function archiveGoal(
  _prev: GoalActionState,
  form: FormData,
): Promise<GoalActionState> {
  await requireUser();
  const id = AimId.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which goal that was.' };

  try {
    const supabase = await createLearnClient();
    await archiveAim(supabase, id.data);
  } catch {
    return { error: 'The goal could not be archived. Try again.' };
  }
  revalidatePath(GOALS_PATH);
  return { done: Date.now() };
}

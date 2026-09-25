'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { TreeActionState } from '@/components/plan-tree/types';
import { requireUser } from '@/lib/auth/server';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { stepStatusFromPlan } from '@/lib/goals/dependencies';
import {
  blockStep,
  deleteDependency,
  insertDependency,
  setStepStatus,
} from '@/lib/goals/steps-store';
import { PLAN_BLOCK_KINDS, PLAN_STATUSES } from '@/lib/plan/load';

/**
 * Blocking a goal step and making it wait on another (plan #981).
 *
 * Each takes the form fields the dev plan's actions take, so the shared tree
 * components in components/plan-tree post to these unchanged: `setStatus`
 * reads `id` and `status`, `addDependency` reads `item` and `depends_on`, and
 * `removeDependency` reads `id`, the dependency row's own. The status is the
 * plan's word or the goal's: not started and in progress are both open.
 */

const Id = z.string().uuid();
const Status = z.enum([...PLAN_STATUSES, 'open']);
const Ask = z.string().trim().max(4000);
const Kind = z.enum(PLAN_BLOCK_KINDS);

function saved(message: string): TreeActionState {
  revalidatePath('/goals', 'layout');
  return { message };
}

/** Open, done, dropped or blocked. Blocking here may carry an `ask`. */
// latency: pending
export async function setGoalStepStatus(
  _prev: TreeActionState,
  form: FormData,
): Promise<TreeActionState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  const status = Status.safeParse(form.get('status'));
  if (!id.success || !status.success) return { error: 'Could not tell which step that was.' };
  const next = status.data === 'open' ? 'open' : stepStatusFromPlan(status.data);
  if (next === null) return { error: 'A step is proposed only by Claude.' };
  try {
    const client = await createGoalsClient();
    if (next === 'blocked') {
      const ask = Ask.safeParse(form.get('ask') ?? '');
      if (!ask.success) return { error: 'Keep what it needs under 4000 characters.' };
      const changed = await blockStep(client, id.data, ask.data || null);
      if (!changed) return { error: 'That step is closed or no longer on the page.' };
      return saved('Blocked.');
    }
    const changed = await setStepStatus(client, id.data, next);
    if (!changed) return { error: 'That step has already changed. Reload to see it.' };
  } catch {
    return { error: 'The step could not be updated. Try again.' };
  }
  return saved('Updated.');
}

/**
 * Block a step with what it needs, in one sentence: the Needs line of the
 * opened step. `kind` is `outside` unless it says `steps`, which clears the
 * block once every step it waits on has closed.
 */
// latency: pending
export async function blockGoalStep(
  _prev: TreeActionState,
  form: FormData,
): Promise<TreeActionState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which step that was.' };
  const ask = Ask.safeParse(form.get('ask') ?? '');
  if (!ask.success) return { error: 'Keep what it needs under 4000 characters.' };
  if (!ask.data) return { error: 'Say what the step needs.' };
  const kind = Kind.safeParse(form.get('kind') ?? 'outside');
  if (!kind.success) return { error: 'Could not tell what the block waits on.' };
  try {
    const changed = await blockStep(await createGoalsClient(), id.data, ask.data, kind.data);
    if (!changed) return { error: 'That step is closed or no longer on the page.' };
  } catch {
    return { error: 'The step could not be blocked. Try again.' };
  }
  return saved('Blocked.');
}

/** "Cannot start until that one is closed." */
// latency: pending
export async function addGoalStepDependency(
  _prev: TreeActionState,
  form: FormData,
): Promise<TreeActionState> {
  const user = await requireUser();
  const item = Id.safeParse(form.get('item'));
  const dependsOn = Id.safeParse(form.get('depends_on'));
  if (!item.success || !dependsOn.success) return { error: 'Pick a step to wait on.' };
  if (item.data === dependsOn.data) return { error: 'A step cannot wait on itself.' };
  try {
    const refused = await insertDependency(
      await createGoalsClient(),
      user.id,
      item.data,
      dependsOn.data,
    );
    if (refused === 'duplicate') return { error: 'It already waits on that step.' };
    if (refused === 'loop') return { error: 'That would make the two steps wait on each other.' };
    if (refused === 'not_steps') return { error: 'Only a step can wait on another step.' };
  } catch {
    return { error: 'That could not be saved. Try again.' };
  }
  return saved('Added.');
}

// latency: pending
export async function removeGoalStepDependency(
  _prev: TreeActionState,
  form: FormData,
): Promise<TreeActionState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Missing dependency.' };
  try {
    const removed = await deleteDependency(await createGoalsClient(), id.data);
    if (!removed) return { error: 'That was already removed. Reload to see it.' };
  } catch {
    return { error: 'That could not be removed. Try again.' };
  }
  return saved('Removed.');
}

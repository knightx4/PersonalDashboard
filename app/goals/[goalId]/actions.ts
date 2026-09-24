'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { countTowards } from '@/lib/goals/rhythms-store';
import { parseStepFields } from '@/lib/goals/steps';
import {
  insertStep,
  linkStep,
  moveStep,
  setStepArchived,
  setStepOnTodo,
  setStepStatus,
  unlinkStep,
  updateStep,
} from '@/lib/goals/steps-store';
import { undismissGoalStep } from '@/lib/todo/agenda/sources/goal-steps';

/**
 * The writes on a goal's full tree (plan #925): add a step or sub-step, edit
 * it, close or reopen it, move it among its siblings, archive it, and count
 * it towards another goal. Each returns a sentence to show rather than
 * throwing. History is written by the database on every one of them.
 */

export type StepActionState = { error?: string; done?: number };

const Id = z.string().uuid();
const Direction = z.enum(['up', 'down']);
const Status = z.enum(['open', 'done', 'dropped']);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function saved(): StepActionState {
  // The home counts steps and every goal's map can show a linked step, so the
  // whole workspace is refreshed rather than guessing which pages changed.
  revalidatePath('/goals', 'layout');
  return { done: Date.now() };
}

// latency: pending
export async function addStep(_prev: StepActionState, form: FormData): Promise<StepActionState> {
  const user = await requireUser();
  const parentId = Id.safeParse(form.get('parentId'));
  if (!parentId.success) return { error: 'Could not tell where that step goes.' };
  const parsed = parseStepFields((key) => form.get(key), { requireTitle: true });
  if (!parsed.ok) return { error: parsed.error };
  const { title, kind, ...rest } = parsed.value;
  if (!title) return { error: 'Give the step a title.' };
  try {
    const added = await insertStep(await createGoalsClient(), user.id, parentId.data, {
      title,
      kind: kind ?? 'mine',
      ...rest,
    });
    if (!added) return { error: 'What that step was going under is no longer on the page.' };
  } catch {
    return { error: 'The step could not be saved. Try again.' };
  }
  return saved();
}

/** An edit sends only the fields that changed. */
// latency: pending
export async function editStep(_prev: StepActionState, form: FormData): Promise<StepActionState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which step that was.' };
  const parsed = parseStepFields((key) => form.get(key));
  if (!parsed.ok) return { error: parsed.error };
  if (Object.keys(parsed.value).length === 0) return {};
  try {
    const changed = await updateStep(await createGoalsClient(), id.data, parsed.value);
    if (!changed) return { error: 'That step is no longer on the page.' };
  } catch {
    return { error: 'The change could not be saved. Try again.' };
  }
  return saved();
}

/** Done, dropped, or open again. */
// latency: pending
export async function setStepStatusAction(form: FormData): Promise<StepActionState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  const status = Status.safeParse(form.get('status'));
  if (!id.success || !status.success) return { error: 'Could not tell which step that was.' };
  try {
    const changed = await setStepStatus(await createGoalsClient(), id.data, status.data);
    if (!changed) return { error: 'That step has already changed. Reload to see it.' };
  } catch {
    return { error: 'The step could not be updated. Try again.' };
  }
  return saved();
}

/**
 * Show on Todo, or take it off (plan #927). The step is not copied anywhere:
 * the flag is what the Todo agenda reads. Showing it again lifts any "Later"
 * or "Not this one" left on Todo from before, since pressing it is asking to
 * see it.
 */
// latency: pending
export async function setStepOnTodoAction(form: FormData): Promise<StepActionState> {
  const user = await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which step that was.' };
  const on = form.get('on') === 'true';
  try {
    const changed = await setStepOnTodo(await createGoalsClient(), id.data, on);
    if (!changed) return { error: 'That step has already changed. Reload to see it.' };
    if (on) await undismissGoalStep(user.id, id.data);
  } catch {
    return {
      error: on
        ? 'The step could not be put on Todo. Try again.'
        : 'The step could not be taken off Todo. Try again.',
    };
  }
  revalidatePath('/todo', 'layout');
  revalidatePath('/home');
  return saved();
}

// latency: pending
export async function countRhythmAction(form: FormData): Promise<StepActionState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  const startsOn = Day.safeParse(form.get('startsOn'));
  if (!id.success || !startsOn.success) return { error: 'Could not tell which rhythm that was.' };
  const by = form.get('by') === '-1' ? -1 : 1;
  try {
    const changed = await countTowards(await createGoalsClient(), id.data, startsOn.data, by);
    if (!changed) {
      return {
        error:
          by === 1
            ? 'That period has closed. Reload to see the current one.'
            : 'There is nothing to take back in this period.',
      };
    }
  } catch {
    return { error: 'The count could not be saved. Try again.' };
  }
  revalidatePath('/todo', 'layout');
  revalidatePath('/home');
  return saved();
}

// latency: pending
export async function moveStepAction(form: FormData): Promise<StepActionState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  const direction = Direction.safeParse(form.get('direction'));
  if (!id.success || !direction.success) return { error: 'Could not tell which step to move.' };
  try {
    await moveStep(await createGoalsClient(), id.data, direction.data);
  } catch {
    return { error: 'The step could not be moved. Try again.' };
  }
  return saved();
}

/** Archive a step, or with `restore` bring it back. */
// latency: pending
export async function archiveStepAction(form: FormData): Promise<StepActionState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which step that was.' };
  const restore = form.get('restore') === 'true';
  try {
    const changed = await setStepArchived(await createGoalsClient(), id.data, !restore);
    if (!changed) return { error: 'That step has already changed. Reload to see it.' };
  } catch {
    return { error: 'The step could not be archived. Try again.' };
  }
  return saved();
}

// latency: pending
export async function linkStepAction(form: FormData): Promise<StepActionState> {
  const user = await requireUser();
  const id = Id.safeParse(form.get('id'));
  const goalId = Id.safeParse(form.get('goalId'));
  if (!id.success || !goalId.success) return { error: 'Could not tell which goal to link.' };
  try {
    await linkStep(await createGoalsClient(), user.id, id.data, goalId.data);
  } catch {
    return { error: 'The step could not be linked to that goal.' };
  }
  return saved();
}

// latency: pending
export async function unlinkStepAction(form: FormData): Promise<StepActionState> {
  await requireUser();
  const linkId = Id.safeParse(form.get('linkId'));
  if (!linkId.success) return { error: 'Could not tell which link that was.' };
  try {
    const changed = await unlinkStep(await createGoalsClient(), linkId.data);
    if (!changed) return { error: 'That link has already gone. Reload to see it.' };
  } catch {
    return { error: 'The link could not be removed. Try again.' };
  }
  return saved();
}

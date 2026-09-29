'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { isOwner } from '@/lib/dev/owner';
import { goalsRoutine } from '@/lib/feedback/routine';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { runInFlight } from '@/lib/goals/shaping';
import { approveGoal, loadAreaRuns, startAreaRun, startGoalRun } from '@/lib/goals/shaping-store';
import {
  archiveArea,
  insertArea,
  insertGoal,
  moveArea,
  moveGoal,
  renameArea,
  setAreaNote,
  setGoalArchived,
  settleGoal,
  unarchiveArea,
  updateGoal,
} from '@/lib/goals/store';
import { parseAreaName, parseAreaNote, parseGoalFields } from '@/lib/goals/tree';

/**
 * The Goals home's writes for areas and goals (plan #924): add, rename,
 * reorder and archive both, write a goal's done-when or its fog, write what
 * you want from an area, and ask Claude to plan an area's goals.
 *
 * Each returns a sentence to show rather than throwing, so a refused write
 * leaves the page standing with the reason beside the control. History is
 * written by the database on every one of them.
 */

export type GoalsActionState = { error?: string; message?: string; done?: number };

const Id = z.string().uuid();
const Direction = z.enum(['up', 'down']);

function saved(): GoalsActionState {
  // The layout, so the daily view on the home and the All goals list both
  // redraw after a change made on either.
  revalidatePath('/goals', 'layout');
  // A new number each time, so a form can tell one save from the next.
  return { done: Date.now() };
}

// latency: pending
export async function addArea(_prev: GoalsActionState, form: FormData): Promise<GoalsActionState> {
  const user = await requireUser();
  const name = parseAreaName(form.get('name'));
  if (!name.ok) return { error: name.error };
  try {
    await insertArea(await createGoalsClient(), user.id, name.value);
  } catch {
    return { error: 'The area could not be saved. Try again.' };
  }
  return saved();
}

// latency: pending
export async function renameAreaAction(
  _prev: GoalsActionState,
  form: FormData,
): Promise<GoalsActionState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which area that was.' };
  const name = parseAreaName(form.get('name'));
  if (!name.ok) return { error: name.error };
  try {
    const changed = await renameArea(await createGoalsClient(), id.data, name.value);
    if (!changed) return { error: 'That area is no longer on the page.' };
  } catch {
    return { error: 'The name could not be saved. Try again.' };
  }
  return saved();
}

/** What you want from an area. Cleared to nothing, it is removed. */
// latency: pending
export async function setAreaNoteAction(
  _prev: GoalsActionState,
  form: FormData,
): Promise<GoalsActionState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which area that was.' };
  const note = parseAreaNote(form.get('note'));
  if (!note.ok) return { error: note.error };
  try {
    const changed = await setAreaNote(await createGoalsClient(), id.data, note.value);
    if (!changed) return { error: 'That area is no longer on the page.' };
  } catch {
    return { error: 'The note could not be saved. Try again.' };
  }
  return saved();
}

/**
 * Plan this area: fire the goals routine to propose the goals an area needs.
 * Only the owner's account can, as with Work on this on a goal, because the
 * run spends the owner's routine allowance.
 */
// latency: pending
export async function planAreaAction(
  _prev: GoalsActionState,
  form: FormData,
): Promise<GoalsActionState> {
  const user = await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which area that was.' };
  if (!(await isOwner({ user }))) {
    return { error: 'Only the account that owns this app can start a Dash run.' };
  }
  const routine = goalsRoutine();
  if (!routine.id) {
    return {
      error:
        'No goals routine on this deployment, so nothing was started. Set ' +
        'CLAUDE_GOALS_ROUTINE_ID to the routine that works goals, and ' +
        'CLAUDE_GOALS_ROUTINE_TOKEN to its token.',
    };
  }

  const client = await createGoalsClient();
  const [area, goals] = await Promise.all([
    client.from('areas').select('id, name, note').eq('id', id.data).is('archived_at', null).maybeSingle(),
    client
      .from('items')
      .select('title, status')
      .eq('area_id', id.data)
      .eq('level', 'goal')
      .is('archived_at', null)
      .order('position'),
  ]);
  if (area.error || !area.data) return { error: 'That area is no longer on the page.' };
  if (goals.error) return { error: 'Could not read the goals in that area. Try again.' };

  let runs;
  try {
    runs = await loadAreaRuns(client);
  } catch {
    return { error: 'Could not tell whether Dash is already on this area. Try again.' };
  }
  if (runInFlight(runs[id.data] ?? null, Date.now())) {
    return { error: 'Dash is already planning this area. Its proposals will show here when it is done.' };
  }

  const result = await startAreaRun({
    client,
    userId: user.id,
    area: {
      id: area.data.id as string,
      name: area.data.name as string,
      note: (area.data.note as string | null) ?? null,
    },
    goals: (goals.data ?? []).map((g) => ({ title: g.title as string, status: g.status as string })),
    routine,
  });
  if (!result.ok) {
    revalidatePath('/goals', 'layout');
    return { error: result.error };
  }
  return saved();
}

/**
 * Approve every goal Claude proposed in one area, as Approve on each goal's
 * page would: each opens with the steps proposed under it.
 */
// latency: pending
export async function approveAreaAction(
  _prev: GoalsActionState,
  form: FormData,
): Promise<GoalsActionState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which area that was.' };
  const client = await createGoalsClient();
  const { data, error } = await client
    .from('items')
    .select('id')
    .eq('area_id', id.data)
    .eq('level', 'goal')
    .eq('status', 'proposed')
    .is('archived_at', null);
  if (error) return { error: 'Could not read the proposed goals. Try again.' };
  let approved = 0;
  for (const row of (data ?? []) as { id: string }[]) {
    try {
      if ((await approveGoal(client, row.id)) !== null) approved += 1;
    } catch {
      saved();
      return { error: `Approved ${approved}, then one could not be saved. Try again for the rest.` };
    }
  }
  if (approved === 0) return { error: 'There is nothing proposed in that area now.' };
  return { ...saved(), message: approved === 1 ? 'Approved 1 goal.' : `Approved ${approved} goals.` };
}

// latency: pending
export async function moveAreaAction(form: FormData): Promise<GoalsActionState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  const direction = Direction.safeParse(form.get('direction'));
  if (!id.success || !direction.success) return { error: 'Could not tell which area to move.' };
  try {
    await moveArea(await createGoalsClient(), id.data, direction.data);
  } catch {
    return { error: 'The area could not be moved. Try again.' };
  }
  return saved();
}

/** Archive an area, or with `restore` bring it back with the goals that went with it. */
// latency: pending
export async function archiveAreaAction(form: FormData): Promise<GoalsActionState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which area that was.' };
  const restore = form.get('restore') === 'true';
  try {
    const client = await createGoalsClient();
    const changed = restore
      ? await unarchiveArea(client, id.data)
      : await archiveArea(client, id.data);
    if (!changed) return { error: 'That area has already changed. Reload to see it.' };
  } catch {
    return { error: 'The area could not be archived. Try again.' };
  }
  return saved();
}

// latency: pending
export async function addGoal(_prev: GoalsActionState, form: FormData): Promise<GoalsActionState> {
  const user = await requireUser();
  const areaId = Id.safeParse(form.get('areaId'));
  if (!areaId.success) return { error: 'Could not tell which area that goal is for.' };
  const parsed = parseGoalFields((key) => form.get(key), { requireTitle: true });
  if (!parsed.ok) return { error: parsed.error };
  // insertGoal reads the area from its own argument, never from these fields.
  const { title, ...rest } = parsed.value;
  if (!title) return { error: 'Give the goal a title.' };
  try {
    const added = await insertGoal(await createGoalsClient(), user.id, areaId.data, {
      title,
      ...rest,
    });
    if (!added) return { error: 'That area is no longer on the page.' };
  } catch {
    return { error: 'The goal could not be saved. Try again.' };
  }
  return saved();
}

/**
 * Add an errand from the Goals home and start Dash on it in the same press
 * (plan #1262): a goal with `errand` set and the date it is due by, then a
 * goal run whose brief says it is an errand. The errand is kept when the run
 * cannot start, and the message says why nothing started, so the one press
 * never loses what was typed.
 */
// latency: pending
export async function addErrand(
  _prev: GoalsActionState,
  form: FormData,
): Promise<GoalsActionState> {
  const user = await requireUser();
  const areaId = Id.safeParse(form.get('areaId'));
  if (!areaId.success) return { error: 'Choose which area the errand is for.' };
  const parsed = parseGoalFields(
    (key) => (key === 'errand' ? 'true' : key === 'title' || key === 'due' ? form.get(key) : null),
    { requireTitle: true },
  );
  if (!parsed.ok) return { error: parsed.error };
  const { title, ...rest } = parsed.value;
  if (!title) return { error: 'Say what the errand is.' };
  if (!rest.dueOn) return { error: 'An errand needs a date it is due by.' };

  const client = await createGoalsClient();
  let goalId: string | null;
  try {
    goalId = await insertGoal(client, user.id, areaId.data, { title, ...rest });
  } catch {
    return { error: 'The errand could not be saved. Try again.' };
  }
  if (!goalId) return { error: 'That area is no longer on the page.' };

  const kept = 'The errand is saved.';
  if (!(await isOwner({ user }))) {
    return {
      ...saved(),
      message: `${kept} Only the account that owns this app can start Dash on it.`,
    };
  }
  const routine = goalsRoutine();
  if (!routine.id) {
    return {
      ...saved(),
      message:
        `${kept} Dash did not start: no goals routine is set on this deployment. Set ` +
        'CLAUDE_GOALS_ROUTINE_ID and CLAUDE_GOALS_ROUTINE_TOKEN, then press Work on this on its page.',
    };
  }
  try {
    const started = await startGoalRun({
      client,
      userId: user.id,
      goal: { id: goalId, title, errandDueOn: rest.dueOn },
      routine,
    });
    if (!started.ok) {
      return {
        ...saved(),
        message: `${kept} Dash could not start (${started.error.replace(/\.$/, '')}). Press Work on this on its page to try again.`,
      };
    }
  } catch {
    return {
      ...saved(),
      message: `${kept} Dash could not start. Press Work on this on its page to try again.`,
    };
  }
  return { ...saved(), message: 'Errand saved. Dash is on it.' };
}

/**
 * An edit sends only the field that changed: the title, the done-when, the
 * fog, or the area it moves to (plan #1160).
 */
// latency: pending
export async function editGoal(_prev: GoalsActionState, form: FormData): Promise<GoalsActionState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which goal that was.' };
  const parsed = parseGoalFields((key) => form.get(key));
  if (!parsed.ok) return { error: parsed.error };
  if (Object.keys(parsed.value).length === 0) return {};
  try {
    const changed = await updateGoal(await createGoalsClient(), id.data, parsed.value);
    if (!changed) {
      return {
        error: parsed.value.areaId
          ? 'That goal or area is no longer on the page. Reload to see it.'
          : 'That goal is no longer on the page.',
      };
    }
  } catch {
    return { error: 'The change could not be saved. Try again.' };
  }
  return saved();
}

// latency: pending
export async function moveGoalAction(form: FormData): Promise<GoalsActionState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  const direction = Direction.safeParse(form.get('direction'));
  if (!id.success || !direction.success) return { error: 'Could not tell which goal to move.' };
  try {
    await moveGoal(await createGoalsClient(), id.data, direction.data);
  } catch {
    return { error: 'The goal could not be moved. Try again.' };
  }
  return saved();
}

/** Archive a goal, or with `restore` bring it back. */
// latency: pending
export async function archiveGoalAction(form: FormData): Promise<GoalsActionState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  if (!id.success) return { error: 'Could not tell which goal that was.' };
  const restore = form.get('restore') === 'true';
  try {
    const changed = await setGoalArchived(await createGoalsClient(), id.data, !restore);
    if (!changed) return { error: 'That goal has already changed. Reload to see it.' };
  } catch {
    return { error: 'The goal could not be archived. Try again.' };
  }
  return saved();
}

const Move = z.enum(['close', 'park', 'keep', 'reopen']);

const MOVE_WORDS: Record<z.infer<typeof Move>, string> = {
  close: 'Closed.',
  park: 'Parked. Take it back up from All goals.',
  keep: 'Kept open.',
  reopen: 'Taken back up.',
};

/**
 * Your answer to a proposal on Today to close or park a goal, or keeping it
 * open instead, and taking a parked or closed goal back up from All goals
 * (plan #1084). Always your own write: the database refuses Claude a change
 * to a goal's status.
 */
// latency: pending
export async function settleGoalAction(
  _prev: GoalsActionState,
  form: FormData,
): Promise<GoalsActionState> {
  await requireUser();
  const id = Id.safeParse(form.get('id'));
  const move = Move.safeParse(form.get('move'));
  if (!id.success || !move.success) return { error: 'Could not tell which goal that was.' };
  try {
    const changed = await settleGoal(await createGoalsClient(), id.data, move.data);
    if (!changed) return { error: 'That goal has already changed. Reload to see it.' };
  } catch {
    return { error: 'The goal could not be changed. Try again.' };
  }
  revalidatePath('/goals', 'layout');
  return { done: Date.now(), message: MOVE_WORDS[move.data] };
}

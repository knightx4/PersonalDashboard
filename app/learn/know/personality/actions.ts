'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createLearnClient } from '@/lib/learn/auth/server';
import {
  deleteTypedResult,
  saveBigFiveResult,
  saveTypedResult,
} from '@/lib/learn/personality/store';
import {
  parseTypedInput,
  type BigFiveResult,
  type TypedDraft,
  type TypedResult,
} from '@/lib/learn/personality/model';
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

export type SaveTypedState =
  | { result: TypedResult }
  | { error: string; field?: 'testName' | 'typedValue' | 'takenAt' | 'note' };

async function typedSave(draft: TypedDraft, id?: string): Promise<SaveTypedState> {
  const user = await requireUser();
  try {
    const [learn, settings] = await Promise.all([
      createLearnClient(),
      loadAccountSettings(user.id),
    ]);
    const parsed = parseTypedInput(draft, todayIn(settings.timezone));
    if ('error' in parsed) return parsed;
    const result = await saveTypedResult(learn, user.id, parsed.input, id);
    revalidatePath('/learn/know');
    return { result };
  } catch (error) {
    console.error('[learn personality] save typed', error instanceof Error ? error.message : error);
    return { error: 'Your type could not be saved. It is still in the form; try again.' };
  }
}

/** Keep a type from another test as written (plan #1633). */
// latency: pending
export async function saveTypedAction(draft: TypedDraft): Promise<SaveTypedState> {
  return typedSave(draft);
}

/** Delete a typed-in type, handing it back for the undo (plan #1633). */
// latency: optimistic
export async function deleteTypedAction(
  id: string,
): Promise<{ removed: TypedResult } | { error: string }> {
  await requireUser();
  try {
    const removed = await deleteTypedResult(await createLearnClient(), id);
    revalidatePath('/learn/know');
    return { removed };
  } catch (error) {
    console.error('[learn personality] delete', error instanceof Error ? error.message : error);
    return { error: 'That type could not be deleted. Try again.' };
  }
}

/** The undo of a delete: the same row back, under the same id. */
// latency: optimistic
export async function restoreTypedAction(removed: TypedResult): Promise<SaveTypedState> {
  return typedSave(
    {
      kind: removed.kind,
      testName: removed.testName,
      typedValue: removed.typedValue,
      takenAt: removed.takenAt,
      note: removed.note ?? undefined,
    },
    removed.id,
  );
}

'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createYouClient } from '@/lib/you/auth/server';
import {
  deleteTypedResult,
  saveBigFiveResult,
  saveTypedResult,
} from '@/lib/you/personality/store';
import {
  parseTypedInput,
  type BigFiveResult,
  type TypedDraft,
  type TypedField,
  type TypedResult,
} from '@/lib/you/personality/model';
import { todayIn } from '@/lib/todo/tasks/model';
import { runPersonalityProfile } from '@/lib/you/personality/profile-run';
import {
  readPersonalityAfterResponse,
  runPersonalityRead,
} from '@/lib/you/personality/read-run';

export type SaveBigFiveState = { result: BigFiveResult } | { error: string };

/**
 * Score and keep a finished Big Five test (plan #1632). Called once, with
 * all 50 answers: the page holds them until the last, so leaving halfway
 * saves nothing. Dash then reads it against your notes once the page has
 * answered (plan #1635), so the save does not wait on the call.
 */
// latency: pending
export async function saveBigFiveAction(answers: number[]): Promise<SaveBigFiveState> {
  const user = await requireUser();
  try {
    const [you, settings] = await Promise.all([
      createYouClient(),
      loadAccountSettings(user.id),
    ]);
    const result = await saveBigFiveResult(you, user.id, answers, todayIn(settings.timezone));
    readPersonalityAfterResponse(you, user.id, result.id);
    revalidatePath('/you/personality', 'layout');
    return { result };
  } catch (error) {
    console.error('[you personality] save', error instanceof Error ? error.message : error);
    return { error: 'Your answers could not be saved. They are still here; try again.' };
  }
}

export type SaveTypedState =
  | { result: TypedResult }
  | { error: string; field?: TypedField };

async function typedSave(
  draft: TypedDraft,
  options: { id?: string; read: boolean },
): Promise<SaveTypedState> {
  const user = await requireUser();
  try {
    const [you, settings] = await Promise.all([
      createYouClient(),
      loadAccountSettings(user.id),
    ]);
    const parsed = parseTypedInput(draft, todayIn(settings.timezone));
    if ('error' in parsed) return parsed;
    const result = await saveTypedResult(you, user.id, parsed.input, options.id);
    if (options.read) readPersonalityAfterResponse(you, user.id, result.id);
    revalidatePath('/you/personality', 'layout');
    return { result };
  } catch (error) {
    console.error('[you personality] save typed', error instanceof Error ? error.message : error);
    return { error: 'Your type could not be saved. It is still in the form; try again.' };
  }
}

/**
 * Keep a type from another test as written (plan #1633), and have Dash read
 * it against your notes once the page has answered (plan #1635).
 */
// latency: pending
export async function saveTypedAction(draft: TypedDraft): Promise<SaveTypedState> {
  return typedSave(draft, { read: true });
}

/** Delete a typed-in type, handing it back for the undo (plan #1633). */
// latency: optimistic
export async function deleteTypedAction(
  id: string,
): Promise<{ removed: TypedResult } | { error: string }> {
  await requireUser();
  try {
    const removed = await deleteTypedResult(await createYouClient(), id);
    revalidatePath('/you/personality', 'layout');
    return { removed };
  } catch (error) {
    console.error('[you personality] delete', error instanceof Error ? error.message : error);
    return { error: 'That type could not be deleted. Try again.' };
  }
}

/**
 * The undo of a delete: the same row back, under the same id. Its read is
 * not run again; the restored row has none until the Personality tab's button asks.
 */
// latency: optimistic
export async function restoreTypedAction(removed: TypedResult): Promise<SaveTypedState> {
  return typedSave(
    {
      kind: removed.kind,
      testName: removed.testName,
      typedValue: removed.typedValue,
      takenAt: removed.takenAt,
      note: removed.note ?? undefined,
      typeScores: removed.typeScores ?? undefined,
      themes: removed.themes,
    },
    { id: removed.id, read: false },
  );
}

export type ReadAgainState = { ok: true } | { error: string };

/**
 * Ask Dash for a fresh read of one result against your notes (plan #1635),
 * from the button under the read on the Personality tab. Waited on: the person
 * pressed for it, and the page shows the new read when it returns.
 */
// latency: pending
export async function readAgainAction(resultId: string): Promise<ReadAgainState> {
  const user = await requireUser();
  try {
    const outcome = await runPersonalityRead(await createYouClient(), user.id, resultId);
    revalidatePath('/you/personality', 'layout');
    return outcome.ok ? { ok: true } : { error: 'Dash could not read it just now. Try again.' };
  } catch (error) {
    console.error('[you personality] read again', error instanceof Error ? error.message : error);
    return { error: 'Dash could not read it just now. Try again.' };
  }
}

export type WriteProfileState = { ok: true } | { error: string };

/**
 * Write Dash's analysis across all your tests, from its button on the
 * Personality tab, which shows only when there is none yet or a test changed
 * since the last. Waited on: the page shows the analysis when it returns.
 */
// latency: pending
export async function writeProfileAction(): Promise<WriteProfileState> {
  const user = await requireUser();
  const outcome = await runPersonalityProfile(await createYouClient(), user.id);
  revalidatePath('/you/personality', 'layout');
  return outcome.ok ? { ok: true } : { error: 'Dash could not write the analysis just now. Try again.' };
}

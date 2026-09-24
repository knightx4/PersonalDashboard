'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createGoalsClient } from '@/lib/goals/auth/server';
import {
  addRecord,
  archiveRecord,
  confirmRecord,
  loadCollection,
  loadRecords,
  restoreRecord,
  updateRecord,
} from '@/lib/goals/collections-store';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  askedFields,
  closesOnSave,
  formValues,
  informationProgress,
  unfinishedReason,
} from '@/lib/goals/information';
import { loadInformationStep, setStepStatus } from '@/lib/goals/steps-store';

/**
 * The writes on an information step's form or table (plan #954): add a row,
 * correct one, confirm a draft, archive a row and bring it back, and say a
 * list is whole. Every value goes through the collection's validator in
 * lib/goals/collections.ts, and a refusal comes back with the field it is
 * about so the form can show it there. A write that leaves a one-record
 * collection complete closes the step.
 */

export type InformationActionState = {
  error?: string;
  /** The key of the field the error is about, when it is about one. */
  field?: string | null;
  done?: number;
  /** The step closed on this write. */
  closed?: boolean;
};

const Id = z.string().uuid();

function saved(closed = false): InformationActionState {
  revalidatePath('/goals', 'layout');
  return { done: Date.now(), closed };
}

/** Close the step when this write left a one-record collection complete. */
async function settle(client: GoalsSupabaseClient, stepId: string): Promise<boolean> {
  const step = await loadInformationStep(client, stepId);
  if (!step || step.status !== 'open') return false;
  const collection = await loadCollection(client, step.collectionId);
  if (!collection) return false;
  const records = await loadRecords(client, step.collectionId);
  const progress = informationProgress(
    collection.shape,
    askedFields(collection.fields, step.asksFor),
    records,
  );
  if (!closesOnSave(collection.shape, progress)) return false;
  return setStepStatus(client, stepId, 'done');
}

/** Add a row, or save a correction to one. Saving a draft you corrected confirms it. */
// latency: pending
export async function saveRecordAction(
  _prev: InformationActionState,
  form: FormData,
): Promise<InformationActionState> {
  const user = await requireUser();
  const stepId = Id.safeParse(form.get('stepId'));
  if (!stepId.success) return { error: 'Could not tell which step that was.' };
  const rawRecord = form.get('recordId');
  const recordId = rawRecord ? Id.safeParse(rawRecord) : null;
  if (recordId && !recordId.success) return { error: 'Could not tell which row that was.' };

  try {
    const client = await createGoalsClient();
    const step = await loadInformationStep(client, stepId.data);
    if (!step) return { error: 'That step no longer has a form.' };
    const collection = await loadCollection(client, step.collectionId);
    if (!collection) return { error: 'The collection behind that step is gone.' };
    const values = formValues(collection.fields, (name) => form.get(name));

    if (recordId) {
      const result = await updateRecord(client, recordId.data, values, undefined, {
        confirm: true,
      });
      if (!result.ok) return { error: result.error, field: result.field };
    } else {
      const existing = await loadRecords(client, step.collectionId);
      const result = await addRecord(
        client,
        user.id,
        step.collectionId,
        values,
        { kind: 'typed' },
        existing.length,
      );
      if (!result.ok) return { error: result.error, field: result.field };
    }
    return saved(await settle(client, stepId.data));
  } catch {
    return { error: 'That could not be saved. Try again.' };
  }
}

/** Confirm a draft as it stands. */
// latency: pending
export async function confirmRecordAction(form: FormData): Promise<InformationActionState> {
  await requireUser();
  const stepId = Id.safeParse(form.get('stepId'));
  const recordId = Id.safeParse(form.get('recordId'));
  if (!stepId.success || !recordId.success) return { error: 'Could not tell which row that was.' };
  try {
    const client = await createGoalsClient();
    const confirmed = await confirmRecord(client, recordId.data);
    if (!confirmed) return { error: 'That row is no longer a draft. Reload to see it.' };
    return saved(await settle(client, stepId.data));
  } catch {
    return { error: 'That could not be confirmed. Try again.' };
  }
}

/** Archive a row, or bring it back for Undo. */
// latency: pending
export async function archiveRecordAction(form: FormData): Promise<InformationActionState> {
  await requireUser();
  const recordId = Id.safeParse(form.get('recordId'));
  if (!recordId.success) return { error: 'Could not tell which row that was.' };
  const restore = form.get('restore') === 'true';
  try {
    const client = await createGoalsClient();
    const changed = restore
      ? await restoreRecord(client, recordId.data)
      : await archiveRecord(client, recordId.data);
    if (!changed) return { error: 'That row has already changed. Reload to see it.' };
  } catch {
    return {
      error: restore ? 'That row could not be brought back.' : 'That row could not be archived.',
    };
  }
  return saved();
}

/** Say a list is whole, which closes the step once every row is confirmed and filled. */
// latency: pending
export async function finishListAction(form: FormData): Promise<InformationActionState> {
  await requireUser();
  const stepId = Id.safeParse(form.get('stepId'));
  if (!stepId.success) return { error: 'Could not tell which step that was.' };
  try {
    const client = await createGoalsClient();
    const step = await loadInformationStep(client, stepId.data);
    if (!step) return { error: 'That step no longer has a form.' };
    if (step.status !== 'open') return { error: 'That step is already closed.' };
    const collection = await loadCollection(client, step.collectionId);
    if (!collection) return { error: 'The collection behind that step is gone.' };
    const records = await loadRecords(client, step.collectionId);
    const progress = informationProgress(
      collection.shape,
      askedFields(collection.fields, step.asksFor),
      records,
    );
    const reason = unfinishedReason(progress);
    if (reason) return { error: reason };
    const closed = await setStepStatus(client, stepId.data, 'done');
    if (!closed) return { error: 'That step has already changed. Reload to see it.' };
    return saved(true);
  } catch {
    return { error: 'The step could not be closed. Try again.' };
  }
}

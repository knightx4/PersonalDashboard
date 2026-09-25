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
import { checkRecord } from '@/lib/goals/collections';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { matchRows, ownsDocumentPath, parseDate, previewRowPrefix } from '@/lib/goals/extract';
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
  /** For a filled-in preview: the index of the row the error is about. */
  row?: number;
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

/**
 * Add a row, or save a correction to one. Saving a draft through the whole
 * form confirms it. A single value changed where it is read sends `keepDraft`,
 * so a draft stays a draft until its Confirm is pressed: one value checked is
 * not the row checked.
 */
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
  const keepDraft = form.get('keepDraft') === 'true';

  try {
    const client = await createGoalsClient();
    const step = await loadInformationStep(client, stepId.data);
    if (!step) return { error: 'That step no longer has a form.' };
    const collection = await loadCollection(client, step.collectionId);
    if (!collection) return { error: 'The collection behind that step is gone.' };
    const values = formValues(collection.fields, (name) => form.get(name));

    if (recordId) {
      const result = await updateRecord(client, recordId.data, values, undefined, {
        confirm: !keepDraft,
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

/**
 * Save the rows read from pasted text or a document (plan #955), once you
 * have checked them. Every row is checked before any is written, so a
 * refusal leaves nothing half-saved. For a one-record collection the row
 * becomes the record, replacing the values of one already there. In a list
 * whose collection has an ID field, a row with the ID of a saved record
 * updates that record instead of adding a copy (plan #985). Every record
 * written is dated by the document's as-of date, which dates the readings of
 * its tracked fields.
 */
// latency: pending
export async function savePreviewAction(
  _prev: InformationActionState,
  form: FormData,
): Promise<InformationActionState> {
  const user = await requireUser();
  const stepId = Id.safeParse(form.get('stepId'));
  if (!stepId.success) return { error: 'Could not tell which step that was.' };
  const source = form.get('source') === 'document' ? 'document' : 'pasted';
  const rawRef = form.get('ref');
  const ref = typeof rawRef === 'string' && rawRef ? rawRef : null;
  if (source === 'document' && (!ref || !ownsDocumentPath(user.id, ref))) {
    return { error: 'Could not tell which file those came from.' };
  }
  const rawAsOf = form.get('asOf');
  const asOf = typeof rawAsOf === 'string' && rawAsOf ? parseDate(rawAsOf) : null;
  if (typeof rawAsOf === 'string' && rawAsOf && !asOf) {
    return { error: 'The date the figures are as of must be a real date.', field: 'asOf' };
  }
  const rows = String(form.get('rows') ?? '')
    .split(',')
    .filter((part) => /^\d{1,3}$/.test(part))
    .map(Number);
  if (rows.length === 0) return { error: 'Every row was left out, so there is nothing to save.' };

  try {
    const client = await createGoalsClient();
    const step = await loadInformationStep(client, stepId.data);
    if (!step) return { error: 'That step no longer has a form.' };
    const collection = await loadCollection(client, step.collectionId);
    if (!collection) return { error: 'The collection behind that step is gone.' };
    const existing = await loadRecords(client, step.collectionId);
    if (collection.shape === 'one' && rows.length > 1) {
      return { error: 'This form holds one record. Leave out all but one row.' };
    }

    const values = rows.map((row) =>
      formValues(collection.fields, (name) => form.get(`${previewRowPrefix(row)}${name}`)),
    );
    // The record each row updates: a one-record form's record, or in a list
    // the saved record with the same ID. Null adds a record.
    const targets =
      collection.shape === 'one'
        ? values.map(() => existing[0]?.id ?? null)
        : matchRows(collection.fields, values, existing);
    const byId = new Map(existing.map((r) => [r.id, r]));
    for (const [i, row] of values.entries()) {
      const target = targets[i] ? byId.get(targets[i]) : undefined;
      const checked = checkRecord(collection.fields, row, target?.data ?? null);
      if (!checked.ok) return { error: checked.error, field: checked.field, row: rows[i] };
    }

    const from = { kind: source, ref, asOf } as const;
    let added = 0;
    for (const [i, row] of values.entries()) {
      const target = targets[i];
      const result = target
        ? await updateRecord(client, target, row, from, { confirm: true })
        : await addRecord(client, user.id, step.collectionId, row, from, existing.length + added++);
      if (!result.ok) {
        return {
          error: i === 0 ? result.error : `${result.error} The rows above it were saved.`,
          field: result.field,
          row: rows[i],
        };
      }
    }
    return saved(await settle(client, stepId.data));
  } catch {
    return { error: 'Those could not be saved. Try again.' };
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

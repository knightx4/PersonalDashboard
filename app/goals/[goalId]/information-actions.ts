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
import { matchRows, ownsDocumentPath, parseDate, previewRowPrefix } from '@/lib/goals/extract';
import {
  MAX_QUESTIONS,
  MAX_QUESTION_LENGTH,
  QUESTION_PREFIX,
  questionKey,
  type StepQuestion,
} from '@/lib/goals/answers';
import { formValues } from '@/lib/goals/information';
import { loadInformationStep, setStepQuestions } from '@/lib/goals/steps-store';

/**
 * The writes on an information step's form or table (plan #954): add a row,
 * correct one, confirm a draft, archive a row and bring it back, and edit
 * the questions the step has to answer. Every value goes through the
 * collection's validator in lib/goals/collections.ts, and a refusal comes
 * back with the field it is about so the form can show it there. Filling
 * the fields never closes the step: it closes once every question has an
 * answer (plan #991), which the database checks when an answer is written.
 */

export type InformationActionState = {
  error?: string;
  /** The key of the field the error is about, when it is about one. */
  field?: string | null;
  done?: number;
  /** The step closed on this write: every question already had its answer. */
  closed?: boolean;
  /** For a filled-in preview: the index of the row the error is about. */
  row?: number;
};

const Id = z.string().uuid();

function saved(closed = false): InformationActionState {
  revalidatePath('/goals', 'layout');
  return { done: Date.now(), closed };
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
    return saved();
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
    return saved();
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
    return saved();
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

/**
 * The questions a submitted form carries, in the order the form lists them:
 * each kept question with its wording as edited, a cleared one left out, and
 * a new one given a key made from its words. An error names what is wrong.
 */
function formQuestions(
  existing: StepQuestion[],
  form: FormData,
): { ok: true; questions: StepQuestion[] } | { ok: false; error: string } {
  const known = new Set(existing.map((q) => q.key));
  const out: StepQuestion[] = [];
  const added: string[] = [];
  for (const [name, raw] of form.entries()) {
    if (!name.startsWith(QUESTION_PREFIX) || typeof raw !== 'string') continue;
    const key = name.slice(QUESTION_PREFIX.length);
    const question = raw.trim().replace(/\s+/g, ' ');
    if (!question) continue;
    if (question.length > MAX_QUESTION_LENGTH) {
      return { ok: false, error: `A question can be at most ${MAX_QUESTION_LENGTH} characters.` };
    }
    if (key === 'new') added.push(question);
    else if (known.has(key) && !out.some((q) => q.key === key)) out.push({ key, question });
  }
  const taken = new Set(existing.map((q) => q.key));
  for (const question of added) {
    const key = questionKey(question, taken);
    taken.add(key);
    out.push({ key, question });
  }
  if (out.length > MAX_QUESTIONS) {
    return { ok: false, error: `A step can hold at most ${MAX_QUESTIONS} questions.` };
  }
  return { ok: true, questions: out };
}

/**
 * Save the questions the step has to answer. A question keeps its key when
 * its wording is edited, so the answer the goals routine wrote for it stays
 * with it. Closes the step when every question already has its answer.
 */
// latency: pending
export async function saveQuestionsAction(
  _prev: InformationActionState,
  form: FormData,
): Promise<InformationActionState> {
  await requireUser();
  const stepId = Id.safeParse(form.get('stepId'));
  if (!stepId.success) return { error: 'Could not tell which step that was.' };
  try {
    const client = await createGoalsClient();
    const step = await loadInformationStep(client, stepId.data);
    if (!step) return { error: 'That step no longer has a form.' };
    const read = formQuestions(step.questions, form);
    if (!read.ok) return { error: read.error };
    const status = await setStepQuestions(client, stepId.data, read.questions);
    if (!status) return { error: 'That step no longer has a form.' };
    return saved(step.status === 'open' && status === 'done');
  } catch {
    return { error: 'The questions could not be saved. Try again.' };
  }
}

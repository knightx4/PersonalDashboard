'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import { serverEnv } from '@/lib/env';
import { createGoalsClient } from '@/lib/goals/auth/server';
import {
  FIELD_TYPES,
  idField,
  type CollectionField,
  type RecordValues,
} from '@/lib/goals/collections';
import { loadCollection, loadRecords, reviseFields } from '@/lib/goals/collections-store';
import {
  DOCUMENT_BUCKET,
  matchRows,
  ownsDocumentPath,
  suggestedKey,
  type Caution,
  type PreviewRow,
  type SuggestedField,
} from '@/lib/goals/extract';
import {
  KIND_NAME_MAX,
  RECOGNISE_MAX,
  SKIPPED_LABEL_MAX,
  SKIPPED_MAX,
  KIND_NOTE_PREFIX,
  editedNotes,
  type KindRead,
} from '@/lib/goals/document-kinds';
import { editKind, forgetKind, loadKinds } from '@/lib/goals/document-kinds-store';
import { askExtractModel } from '@/lib/goals/extract-model';
import { readIntoForm, type ReadInput } from '@/lib/goals/extract-read';
import { loadInformationStep } from '@/lib/goals/steps-store';

/**
 * Reading pasted text or a document into an information step's form (plan
 * #955; docs/GOALS-SPEC.md, "Four ways to fill a form"). This only reads:
 * it hands back the rows the form starts from and saves nothing. Saving is
 * savePreviewAction in ./information-actions.ts, once you have checked them.
 *
 * A document is already in the goals-documents bucket when this runs. The
 * browser uploads it on your session, which keeps the file out of this
 * action's request body, and this reads it back on the same session, so the
 * bucket's policies (goals migration 0011) decide whose files it can reach.
 */

export type ReadFormState = {
  error?: string;
  rows?: PreviewRow[];
  source?: 'pasted' | 'document';
  /** The stored file's path, for a document. */
  ref?: string | null;
  /** The date the document gives its figures as of (plan #985). */
  asOf?: string | null;
  /**
   * For each row, the values of the saved record it will update: the one
   * with the same ID, or a one-record form's record. Null for a row that
   * adds a record.
   */
  before?: (RecordValues | null)[];
  /** Fields the document has and the form lacks (plan #986). */
  suggestions?: SuggestedField[];
  /** Labels in the document that do not mean what they say. */
  cautions?: Caution[];
  /**
   * The kind of document the reader took it for (plan #987), and whether it
   * is one the form has learned before.
   */
  kind?: KindRead | null;
};

const Input = z.union([
  z.object({ stepId: z.string().uuid(), text: z.string().max(200_000) }),
  z.object({ stepId: z.string().uuid(), path: z.string().min(1).max(500) }),
]);

function apiKey(): string | null {
  try {
    return serverEnv().ANTHROPIC_API_KEY ?? null;
  } catch {
    return process.env.ANTHROPIC_API_KEY ?? null;
  }
}

// latency: pending
export async function readIntoFormAction(
  raw: { stepId: string; text: string } | { stepId: string; path: string },
): Promise<ReadFormState> {
  const user = await requireUser();
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { error: 'Could not tell what to read.' };
  const input = parsed.data;

  const key = apiKey();
  if (!key) return { error: 'No ANTHROPIC_API_KEY on the deployment, so nothing can be read.' };

  const spend: SpendReport[] = [];
  try {
    const client = await createGoalsClient();
    const step = await loadInformationStep(client, input.stepId);
    if (!step) return { error: 'That step no longer has a form.' };
    const collection = await loadCollection(client, step.collectionId);
    if (!collection) return { error: 'The collection behind that step is gone.' };

    let read: ReadInput;
    let ref: string | null = null;
    if ('path' in input) {
      if (!ownsDocumentPath(user.id, input.path)) return { error: 'Could not find that file.' };
      const { data, error } = await client.storage.from(DOCUMENT_BUCKET).download(input.path);
      if (error || !data) return { error: 'That file could not be opened. Try uploading it again.' };
      read = { name: input.path, bytes: new Uint8Array(await data.arrayBuffer()) };
      ref = input.path;
    } else {
      read = { text: input.text };
    }

    const kinds = await loadKinds(client, [collection.id]);
    const result = await readIntoForm(
      collection,
      read,
      (source) =>
        askExtractModel(
          { apiKey: key, onSpend: (report) => spend.push(report) },
          collection,
          source,
          kinds,
        ),
      kinds,
    );
    await recordSessionSpend(user.id, { module: 'goals', operation: 'read-into-form' }, spend);
    if (!result.ok) return { error: result.error };
    const records = await loadRecords(client, step.collectionId);
    const byId = new Map(records.map((r) => [r.id, r.data]));
    const before =
      collection.shape === 'one'
        ? result.rows.map(() => records[0]?.data ?? null)
        : matchRows(collection.fields, result.rows, records).map((id) =>
            id ? (byId.get(id) ?? null) : null,
          );
    return {
      rows: result.rows,
      source: ref ? 'document' : 'pasted',
      ref,
      asOf: result.asOf,
      before,
      suggestions: result.suggestions,
      cautions: result.cautions,
      kind: result.kind,
    };
  } catch {
    await recordSessionSpend(user.id, { module: 'goals', operation: 'read-into-form' }, spend);
    return { error: 'That could not be read. Try again.' };
  }
}

const Suggested = z.object({
  stepId: z.string().uuid(),
  field: z.object({
    key: z.string().min(1).max(40),
    label: z.string().min(1).max(200),
    type: z.enum(FIELD_TYPES),
    options: z.array(z.string()).max(100).optional(),
    id: z.boolean().optional(),
  }),
});

export type AddFieldState = { error?: string; field?: CollectionField };

/**
 * Add a field the document suggested to the form behind a step (plan #986).
 * It goes through reviseFields, so the definition check applies and the
 * collection's version goes up. The key is taken afresh if the collection
 * used it since the read, and the field is only the ID while the collection
 * has none. It hands back the field as added, so the preview can fill it in
 * for every row.
 */
// latency: pending
export async function addSuggestedFieldAction(raw: {
  stepId: string;
  field: CollectionField;
}): Promise<AddFieldState> {
  await requireUser();
  const parsed = Suggested.safeParse(raw);
  if (!parsed.success) return { error: 'Could not tell which field to add.' };
  const { stepId, field: asked } = parsed.data;

  try {
    const client = await createGoalsClient();
    const step = await loadInformationStep(client, stepId);
    if (!step) return { error: 'That step no longer has a form.' };
    const collection = await loadCollection(client, step.collectionId);
    if (!collection) return { error: 'The collection behind that step is gone.' };

    const taken = new Set(collection.fields.map((f) => f.key));
    const field: CollectionField = {
      key: taken.has(asked.key) ? suggestedKey(asked.label, taken) : asked.key,
      label: asked.label.trim(),
      type: asked.type,
    };
    if (asked.type === 'choice' && asked.options) field.options = asked.options;
    if (asked.id && !idField(collection.fields)) field.id = true;

    const result = await reviseFields(client, collection.id, [...collection.fields, field]);
    if (!result.ok) return { error: result.error };
    revalidatePath('/goals', 'layout');
    return { field };
  } catch {
    return { error: 'That field could not be added. Try again.' };
  }
}

export type KindActionState = { error?: string; done?: number };

/**
 * Save the person's edit of a kind of document on a step (plan #987): its
 * name, how to recognise it, the note for each field, and the labels it
 * leaves out, one per line. Clearing a note drops it.
 */
// latency: pending
export async function saveDocumentKindAction(
  _prev: KindActionState,
  form: FormData,
): Promise<KindActionState> {
  await requireUser();
  const stepId = z.string().uuid().safeParse(form.get('stepId'));
  const kindId = z.string().uuid().safeParse(form.get('kindId'));
  if (!stepId.success || !kindId.success) return { error: 'Could not tell which kind that was.' };
  const name = String(form.get('name') ?? '').trim();
  if (!name) return { error: 'Give the kind a name.' };
  if (name.length > KIND_NAME_MAX) return { error: `A name can be at most ${KIND_NAME_MAX} characters.` };
  const recognise = String(form.get('recognise') ?? '').trim();
  if (recognise.length > RECOGNISE_MAX) {
    return { error: `How to recognise it can be at most ${RECOGNISE_MAX} characters.` };
  }
  const skipped = [
    ...new Set(
      String(form.get('skipped') ?? '')
        .split('\n')
        .map((line) => line.trim().slice(0, SKIPPED_LABEL_MAX))
        .filter(Boolean),
    ),
  ].slice(0, SKIPPED_MAX);

  try {
    const client = await createGoalsClient();
    const step = await loadInformationStep(client, stepId.data);
    if (!step) return { error: 'That step no longer has a form.' };
    const collection = await loadCollection(client, step.collectionId);
    if (!collection) return { error: 'The collection behind that step is gone.' };
    const fieldNotes = editedNotes(collection.fields, (key) => form.get(`${KIND_NOTE_PREFIX}${key}`));
    const result = await editKind(client, kindId.data, { name, recognise, fieldNotes, skipped });
    if (!result.ok) return { error: result.error };
    revalidatePath('/goals', 'layout');
    return { done: Date.now() };
  } catch {
    return { error: 'That could not be saved. Try again.' };
  }
}

/** Forget a kind of document, so the next one like it is read as new. */
// latency: pending
export async function forgetDocumentKindAction(form: FormData): Promise<KindActionState> {
  await requireUser();
  const kindId = z.string().uuid().safeParse(form.get('kindId'));
  if (!kindId.success) return { error: 'Could not tell which kind that was.' };
  try {
    const client = await createGoalsClient();
    const forgotten = await forgetKind(client, kindId.data);
    if (!forgotten) return { error: 'That kind is already gone. Reload to see.' };
    revalidatePath('/goals', 'layout');
    return { done: Date.now() };
  } catch {
    return { error: 'That could not be forgotten. Try again.' };
  }
}

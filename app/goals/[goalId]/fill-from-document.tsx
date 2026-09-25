'use client';

import { useActionState, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FieldError, Input, Textarea } from '@/components/ui/field';
import { PaidHint } from '@/components/ui/paid-hint';
import { useToast } from '@/components/ui/toast';
import { createClient } from '@/lib/auth/client';
import { idField, liveFields, type RecordValues } from '@/lib/goals/collections';
import type { Collection } from '@/lib/goals/collections-store';
import {
  DOCUMENT_BUCKET,
  DOCUMENT_MAX_BYTES,
  documentContentType,
  documentPath,
  previewRowPrefix,
  type PreviewRow,
} from '@/lib/goals/extract';
import { displayValue, documentName, inputValue } from '@/lib/goals/information';
import { readIntoFormAction, type ReadFormState } from './document-actions';
import { FieldInput } from './field-input';
import { savePreviewAction, type InformationActionState } from './information-actions';

/**
 * Fill an information step's form from pasted text or a document (plan #955;
 * docs/GOALS-SPEC.md, "Four ways to fill a form"). Paste a servicer page or
 * choose a statement PDF, screenshot or Word file; the model reads it against
 * the form, and what it found comes back as the form filled in. You correct
 * it, leave out any row that is wrong, and nothing is saved until you press
 * Save.
 *
 * A file is uploaded from here straight to the private goals-documents
 * bucket, into your own folder, and the read action takes its path. The
 * records saved from it keep that path, so the step can link to the file.
 *
 * A row that matches a saved record by the collection's ID field, or the
 * record of a one-record form, updates it (plan #985). Such a row starts from
 * the saved values wherever the read found nothing, and each value it would
 * change shows the saved one beside it. The date the document gives its
 * figures as of is shown and can be corrected; it dates the readings.
 */

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.docx,.txt,.csv,.html,.htm';
const READ_ACTION = 'app/goals/[goalId]/document-actions.ts#readIntoFormAction';

type Preview = {
  rows: PreviewRow[];
  source: 'pasted' | 'document';
  ref: string | null;
  asOf: string | null;
  /** For each row, the saved values it updates, or null for a new record. */
  before: (RecordValues | null)[];
};

export function FillFromDocument({
  stepId,
  collection,
  onClose,
}: {
  stepId: string;
  collection: Collection;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);

  if (preview) {
    return (
      <PreviewForm
        stepId={stepId}
        collection={collection}
        preview={preview}
        onBack={() => setPreview(null)}
        onClose={onClose}
      />
    );
  }
  return <ReadForm stepId={stepId} onRead={setPreview} onClose={onClose} />;
}

function ReadForm({
  stepId,
  onRead,
  onClose,
}: {
  stepId: string;
  onRead: (preview: Preview) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [state, read, reading] = useActionState(async (): Promise<ReadFormState> => {
    let result: ReadFormState;
    if (file) {
      const uploaded = await upload(file);
      if ('error' in uploaded) return { error: uploaded.error };
      result = await readIntoFormAction({ stepId, path: uploaded.path });
    } else {
      result = await readIntoFormAction({ stepId, text });
    }
    if (result.rows && result.source) {
      onRead({
        rows: result.rows,
        source: result.source,
        ref: result.ref ?? null,
        asOf: result.asOf ?? null,
        before: result.before ?? [],
      });
    }
    return result;
  }, {});

  return (
    <form action={read} className="space-y-3 rounded-control bg-sunken p-3">
      <Field id={`${id}-paste`} label="Paste text">
        {/* ui-ok: composer-always-open -- this panel only exists once
          * "Fill in from text or a document" was pressed on the step. */}
        <Textarea
          id={`${id}-paste`}
          rows={4}
          value={text}
          disabled={file !== null}
          placeholder="Copy the page from your lender's site and paste it here."
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      {/* A file input keeps its native control; only the label is ours. */}
      <Field id={`${id}-file`} label="Or choose a file" hint="A PDF, screenshot, Word file or text, up to 20 MB.">
        <input
          id={`${id}-file`}
          type="file"
          accept={ACCEPT}
          className="block w-full text-body text-ink-muted"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          size="sm"
          pending={reading}
          disabled={!file && text.trim() === ''}
        >
          {reading ? 'Reading…' : 'Read it'}
        </Button>
        <PaidHint action={READ_ACTION} what="Cost of reading it into the form" />
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
      <FieldError>{state.error}</FieldError>
    </form>
  );
}

/** Put the file in your folder of the bucket, under a fresh name. */
async function upload(file: File): Promise<{ path: string } | { error: string }> {
  const contentType = documentContentType(file.name);
  if (!contentType) {
    return { error: 'That kind of file cannot be read. Use a PDF, an image, a Word file or text.' };
  }
  if (file.size > DOCUMENT_MAX_BYTES) return { error: 'That file is over 20 MB.' };
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: 'You are signed out. Sign in again to upload.' };
  const path = documentPath(data.user.id, crypto.randomUUID(), file.name);
  const { error } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .upload(path, file, { contentType, upsert: false });
  if (error) return { error: 'That file could not be uploaded. Try again.' };
  return { path };
}

function PreviewForm({
  stepId,
  collection,
  preview,
  onBack,
  onClose,
}: {
  stepId: string;
  collection: Collection;
  preview: Preview;
  onBack: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const formId = useId();
  const fields = liveFields(collection.fields);
  const [kept, setKept] = useState(() => preview.rows.map((_, i) => i));
  const [state, save, saving] = useActionState(
    async (prev: InformationActionState, form: FormData) => {
      const result = await savePreviewAction(prev, form);
      if (!result.error) {
        toast({
          text: result.closed
            ? 'Saved. The step has what it asked for and is closed.'
            : kept.length === 1
              ? 'Saved.'
              : `Saved ${kept.length} rows.`,
        });
        onClose();
      }
      return result;
    },
    {},
  );

  // A row that updates a saved record keeps what it holds wherever the read found nothing.
  const startingValue = (index: number, key: string) => {
    const found = preview.rows[index][key] ?? '';
    const saved = preview.before[index];
    if (found !== '' || !saved) return found;
    const field = fields.find((f) => f.key === key);
    return field ? inputValue(field, saved[key]) : '';
  };
  // The saved value a row would change, shown beside the new one.
  const replaces = (index: number, key: string): string | null => {
    const saved = preview.before[index];
    const field = fields.find((f) => f.key === key);
    if (!saved || !field) return null;
    const was = inputValue(field, saved[key]);
    if (was === '' || was === startingValue(index, key)) return null;
    return displayValue(field, saved[key]);
  };
  const updating = preview.before.filter(Boolean).length;
  const id = idField(collection.fields);
  const from =
    preview.source === 'document' && preview.ref
      ? `Read from ${documentName(preview.ref)}.`
      : 'Read from the text you pasted.';
  const many = collection.shape === 'list' && preview.rows.length > 1;
  const by = id?.label ?? 'its ID';
  const matched =
    updating === 0
      ? null
      : collection.shape === 'one'
        ? 'Saving replaces what the form holds.'
        : updating === preview.rows.length
          ? preview.rows.length === 1
            ? `This row matches a saved row by ${by}, so saving updates it.`
            : `Every row matches a saved row by ${by}, so saving updates them rather than adding copies.`
          : `${updating} of ${preview.rows.length} rows match a saved row by ${by} and update it; the rest are added.`;
  const matchLine = matched && `${matched} Where a value changes, the saved one is shown beneath it.`;

  return (
    <form action={save} className="space-y-3 rounded-control bg-sunken p-3">
      <input type="hidden" name="stepId" value={stepId} />
      <input type="hidden" name="source" value={preview.source} />
      {preview.ref && <input type="hidden" name="ref" value={preview.ref} />}
      <input type="hidden" name="rows" value={kept.join(',')} />
      <p className="text-small text-ink-muted">
        {from} Check {many ? 'each row' : 'it'} and correct anything wrong. Nothing is saved until
        you press Save.
      </p>
      {matchLine && <p className="text-small text-ink-muted">{matchLine}</p>}
      <Field
        id={`${formId}-as-of`}
        label="Figures as of"
        hint="The date the document gives its figures. Balances are charted on this date; leave it empty for today."
        error={state.field === 'asOf' && state.row === undefined ? state.error : undefined}
        className="sm:max-w-xs"
      >
        <Input id={`${formId}-as-of`} name="asOf" type="date" defaultValue={preview.asOf ?? ''} />
      </Field>

      {kept.map((index) => {
        const updates = collection.shape === 'list' && preview.before[index] !== null;
        return (
          <fieldset key={index} className="space-y-2" aria-label={`Row ${index + 1}`}>
            {many && (
              <div className="flex items-center justify-between gap-2">
                <p className="text-ui font-medium text-ink">
                  Row {index + 1}
                  {updates && (
                    <span className="font-normal text-ink-muted"> · updates a saved row</span>
                  )}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setKept((rows) => rows.filter((r) => r !== index))}
                >
                  Leave out
                </Button>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((field) => {
                const inputId = `${formId}-${index}-${field.key}`;
                const was = replaces(index, field.key);
                return (
                  <Field
                    key={field.key}
                    id={inputId}
                    label={field.label}
                    hint={was !== null ? `Saved: ${was}` : undefined}
                    error={state.row === index && state.field === field.key ? state.error : undefined}
                    className={field.type === 'long_text' ? 'sm:col-span-2' : undefined}
                  >
                    <FieldInput
                      id={inputId}
                      field={field}
                      value={startingValue(index, field.key)}
                      namePrefix={previewRowPrefix(index)}
                    />
                  </Field>
                );
              })}
            </div>
          </fieldset>
        );
      })}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" pending={saving} disabled={kept.length === 0}>
          {many && kept.length > 1 ? `Save ${kept.length} rows` : 'Save'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onBack}>
          Read something else
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Discard
        </Button>
      </div>
      {state.error &&
        state.field !== 'asOf' &&
        !(state.row !== undefined && fields.some((f) => f.key === state.field)) && (
        <FieldError>{state.error}</FieldError>
      )}
    </form>
  );
}

'use client';

import { useActionState, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FieldError, Textarea } from '@/components/ui/field';
import { PaidHint } from '@/components/ui/paid-hint';
import { useToast } from '@/components/ui/toast';
import { createClient } from '@/lib/auth/client';
import { liveFields } from '@/lib/goals/collections';
import type { Collection, CollectionRecord } from '@/lib/goals/collections-store';
import {
  DOCUMENT_BUCKET,
  DOCUMENT_MAX_BYTES,
  documentContentType,
  documentPath,
  previewRowPrefix,
  type PreviewRow,
} from '@/lib/goals/extract';
import { documentName, inputValue } from '@/lib/goals/information';
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
 */

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.docx,.txt,.csv,.html,.htm';
const READ_ACTION = 'app/goals/[goalId]/document-actions.ts#readIntoFormAction';

type Preview = { rows: PreviewRow[]; source: 'pasted' | 'document'; ref: string | null };

export function FillFromDocument({
  stepId,
  collection,
  current,
  onClose,
}: {
  stepId: string;
  collection: Collection;
  /** A one-record collection's record, whose values fill any gap the read leaves. */
  current: CollectionRecord | null;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);

  if (preview) {
    return (
      <PreviewForm
        stepId={stepId}
        collection={collection}
        current={current}
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
      onRead({ rows: result.rows, source: result.source, ref: result.ref ?? null });
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
  current,
  preview,
  onBack,
  onClose,
}: {
  stepId: string;
  collection: Collection;
  current: CollectionRecord | null;
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

  // A one-record form keeps what it already holds wherever the read found nothing.
  const startingValue = (row: PreviewRow, key: string) => {
    const found = row[key] ?? '';
    if (found !== '' || !current) return found;
    const field = fields.find((f) => f.key === key);
    return field ? inputValue(field, current.data[key]) : '';
  };
  const from =
    preview.source === 'document' && preview.ref
      ? `Read from ${documentName(preview.ref)}.`
      : 'Read from the text you pasted.';
  const many = collection.shape === 'list' && preview.rows.length > 1;

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

      {kept.map((index) => {
        const row = preview.rows[index];
        return (
          <fieldset key={index} className="space-y-2" aria-label={`Row ${index + 1}`}>
            {many && (
              <div className="flex items-center justify-between gap-2">
                <p className="text-ui font-medium text-ink">Row {index + 1}</p>
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
                return (
                  <Field
                    key={field.key}
                    id={inputId}
                    label={field.label}
                    error={state.row === index && state.field === field.key ? state.error : undefined}
                    className={field.type === 'long_text' ? 'sm:col-span-2' : undefined}
                  >
                    <FieldInput
                      id={inputId}
                      field={field}
                      value={startingValue(row, field.key)}
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
      {state.error && !(state.row !== undefined && fields.some((f) => f.key === state.field)) && (
        <FieldError>{state.error}</FieldError>
      )}
    </form>
  );
}

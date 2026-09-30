'use client';

import { useActionState, useId, useRef, useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, FieldError, Input, Textarea } from '@/components/ui/field';
import { PaidHint } from '@/components/ui/paid-hint';
import { useToast } from '@/components/ui/toast';
import { createClient } from '@/lib/auth/client';
import { cn } from '@/lib/cn';
import {
  PASTED_FILE_NAME,
  TRANSCRIPT_ACCEPT,
  courseFieldName,
  transcriptContentType,
} from '@/lib/vault/education';
import type { DraftCourse } from '@/lib/vault/transcript-read';
import { TRANSCRIPT_MAX_BYTES, VAULT_TRANSCRIPTS_BUCKET, transcriptStoragePath } from '@/lib/vault/transcripts';
import {
  discardUploadAction,
  readTranscriptAction,
  saveTranscriptAction,
  type ReadTranscriptState,
  type SaveTranscriptState,
  type TranscriptDraft,
} from './actions';

/**
 * Adding a transcript (plan #1308): upload a file or paste the text, have
 * Dash read the courses off it, check and correct them, then save. The
 * check-before-saving view follows Learn's prior-knowledge form
 * (app/learn/know/prior-form.tsx): nothing is written until you press Save,
 * because a misread grade would otherwise sit in the list looking right.
 *
 * The file goes from the browser straight into your folder of the private
 * vault-transcripts bucket, as the goals document reader's does, and pasted
 * text is kept as a .txt file so every transcript has an original to open.
 */

const READ_ACTION = 'app/vault/education/actions.ts#readTranscriptAction';

export function AddTranscript({ empty }: { empty: boolean }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TranscriptDraft | null>(null);

  if (draft) {
    return (
      <CheckCourses
        draft={draft}
        onDone={() => {
          setDraft(null);
          setOpen(false);
        }}
      />
    );
  }
  if (open) return <UploadForm onRead={setDraft} onCancel={() => setOpen(false)} />;
  if (empty) {
    return (
      <EmptyState
        icon={GraduationCap}
        title="No transcripts yet"
        description="Add your academic transcripts as a PDF, a Word document, a photo or pasted text. Dash reads every course off each one, with its school, term, grade and credits, and you check the list before it is saved. The original is kept so you can open it again."
      >
        <Button type="button" className="mt-4" onClick={() => setOpen(true)}>
          Add a transcript
        </Button>
      </EmptyState>
    );
  }
  return <AddTrigger label="Add a transcript" onClick={() => setOpen(true)} className="mb-3" />;
}

export function UploadForm({ onRead, onCancel }: { onRead: (draft: TranscriptDraft) => void; onCancel: () => void }) {
  const id = useId();
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [state, read, reading] = useActionState(async (): Promise<ReadTranscriptState> => {
    const chosen = file ?? new File([text], PASTED_FILE_NAME, { type: 'text/plain' });
    const uploaded = await upload(chosen);
    if ('error' in uploaded) return { error: uploaded.error };
    const result = await readTranscriptAction({ path: uploaded.path, fileName: chosen.name });
    if (result.draft) onRead(result.draft);
    return result;
  }, {});

  return (
    <form action={read} className={cn(cardVariants({ padding: 'standard' }), 'mb-4 space-y-3')}>
      <Field
        id={`${id}-file`}
        label="Choose a transcript"
        hint="A PDF, a Word document or a photo, up to 20 MB."
      >
        {/* A file input keeps its native control; only the label is ours. */}
        <input
          id={`${id}-file`}
          type="file"
          accept={TRANSCRIPT_ACCEPT}
          className={cn(
            'block w-full text-body text-ink-muted',
            // The native button reads as plain text in every theme; draw it as a secondary button.
            'file:mr-3 file:h-(--control-h) file:cursor-pointer file:rounded-control file:border file:border-control',
            'file:bg-surface file:px-3 file:text-ui file:font-medium file:text-ink hover:file:bg-sunken',
          )}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </Field>
      <Field id={`${id}-paste`} label="Or paste the text">
        {/* ui-ok: composer-always-open -- this form only renders once "Add a
          * transcript" was pressed; the list below it is a different component. */}
        <Textarea
          id={`${id}-paste`}
          rows={4}
          maxLength={200_000}
          value={text}
          disabled={file !== null}
          placeholder="Copy the transcript from your school's student portal and paste it here."
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" pending={reading} disabled={!file && text.trim() === ''}>
          {reading ? 'Reading…' : 'Read the courses'}
        </Button>
        <PaidHint action={READ_ACTION} what="Cost of reading the transcript" />
        <Button type="button" variant="ghost" onClick={onCancel} disabled={reading}>
          Cancel
        </Button>
      </div>
      <FieldError>{state.error}</FieldError>
    </form>
  );
}

/** Put the file in your folder of the bucket, under a fresh name. */
async function upload(file: File): Promise<{ path: string } | { error: string }> {
  const contentType = transcriptContentType(file.name);
  if (!contentType) {
    return { error: 'That kind of file cannot be read. Use a PDF, a Word document, a photo or text.' };
  }
  if (file.size > TRANSCRIPT_MAX_BYTES) return { error: 'That file is over 20 MB.' };
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: 'You are signed out. Sign in again to upload.' };
  const path = transcriptStoragePath(data.user.id, file.name, crypto.randomUUID());
  const { error } = await supabase.storage
    .from(VAULT_TRANSCRIPTS_BUCKET)
    .upload(path, file, { contentType, upsert: false });
  if (error) return { error: 'That file could not be uploaded. Try again.' };
  return { path };
}

type Row = { key: number; course: DraftCourse; ownSchool: boolean };

const same = (a: string | null, b: string | null) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

const BLANK: DraftCourse = {
  school: null,
  code: null,
  title: '',
  term: null,
  year: null,
  credits: null,
  grade: null,
  position: 0,
};

/**
 * The wide grid: code, title, term, year, credits, grade, and the remove
 * button. Below lg the row stacks in six columns (title; code and term; year,
 * credits and grade), since seven columns leave the title no room at tablet
 * width.
 */
const GRID = 'lg:grid-cols-[7.5rem_minmax(0,1fr)_7.5rem_4rem_4rem_4rem_5.5rem]';

export function CheckCourses({ draft, onDone }: { draft: TranscriptDraft; onDone: () => void }) {
  const id = useId();
  const toast = useToast();
  const next = useRef(draft.courses.length);
  const [rows, setRows] = useState<Row[]>(() =>
    draft.courses.map((course, key) => ({
      key,
      course,
      // A course taken somewhere other than the issuing school, such as a
      // transfer credit, shows its own school to check.
      ownSchool: course.school !== null && !same(course.school, draft.school),
    })),
  );
  const [state, save, saving] = useActionState(
    async (prev: SaveTranscriptState, form: FormData) => {
      const result = await saveTranscriptAction(prev, form);
      if (result.saved) {
        toast({
          text: `Saved ${result.saved.courses} ${result.saved.courses === 1 ? 'course' : 'courses'} from ${result.saved.school}.`,
        });
        onDone();
      }
      return result;
    },
    {},
  );
  const [discarding, setDiscarding] = useState(false);
  const discard = async () => {
    setDiscarding(true);
    await discardUploadAction(draft.path).catch(() => undefined);
    onDone();
  };

  const count = rows.length;

  return (
    <form action={save} className="mb-4">
      <input type="hidden" name="path" value={draft.path} />
      <input type="hidden" name="fileName" value={draft.fileName} />
      <input type="hidden" name="sizeBytes" value={draft.sizeBytes} />
      <input type="hidden" name="rows" value={rows.map((r) => r.key).join(',')} />

      <p className="mb-3 text-body text-ink-muted">
        Dash read {draft.courses.length} {draft.courses.length === 1 ? 'course' : 'courses'} from{' '}
        {draft.fileName}. Check each one against the transcript and correct anything misread. Nothing is saved
        until you press Save.
      </p>

      <div className={cn(cardVariants({ padding: 'standard' }), 'mb-3')}>
        <Field
          id={`${id}-school`}
          label="School"
          hint={draft.school ? 'The school that issued the transcript, as Dash read it.' : 'Dash could not find the school on the transcript. Say which it is.'}
          error={state.field === 'school' && state.row === undefined ? state.error : undefined}
          className="sm:max-w-md"
        >
          <Input id={`${id}-school`} name="school" required maxLength={200} defaultValue={draft.school ?? ''} />
        </Field>
      </div>

      <div className={cn(cardVariants(), 'overflow-hidden')}>
        <div
          className={cn(
            'hidden gap-2 border-b border-border px-4 py-2 text-small font-medium text-ink-muted lg:grid',
            GRID,
          )}
          aria-hidden
        >
          <span>Code</span>
          <span>Title</span>
          <span>Term</span>
          <span>Year</span>
          <span>Credits</span>
          <span>Grade</span>
          <span />
        </div>
        <ul className="divide-y divide-border">
          {rows.map((row, index) => (
            <li key={row.key} className="px-4 py-3">
              <fieldset aria-label={`Course ${index + 1}`} className={cn('grid grid-cols-6 gap-2', GRID)}>
                <Cell
                  label="Title"
                  name={courseFieldName(row.key, 'title')}
                  value={row.course.title}
                  max={300}
                  required
                  className="col-span-6 lg:col-span-1 lg:col-start-2 lg:row-start-1"
                />
                <Cell
                  label="Code"
                  name={courseFieldName(row.key, 'code')}
                  value={row.course.code}
                  max={50}
                  className="col-span-3 lg:col-span-1 lg:col-start-1 lg:row-start-1"
                />
                <Cell
                  label="Term"
                  name={courseFieldName(row.key, 'term')}
                  value={row.course.term}
                  max={50}
                  className="col-span-3 lg:col-span-1"
                />
                <Cell
                  label="Year"
                  name={courseFieldName(row.key, 'year')}
                  value={row.course.year}
                  inputMode="numeric"
                  className="col-span-2 lg:col-span-1"
                />
                <Cell
                  label="Credits"
                  name={courseFieldName(row.key, 'credits')}
                  value={row.course.credits}
                  inputMode="decimal"
                  className="col-span-2 lg:col-span-1"
                />
                <Cell
                  label="Grade"
                  name={courseFieldName(row.key, 'grade')}
                  value={row.course.grade}
                  max={20}
                  className="col-span-2 lg:col-span-1"
                />
                {row.ownSchool && (
                  <Cell
                    label="Taken at"
                    name={courseFieldName(row.key, 'school')}
                    value={row.course.school}
                    max={200}
                    showLabel
                    className="col-span-6 lg:col-span-4 lg:col-start-2"
                  />
                )}
                <div className="col-span-6 -mt-1 flex items-end justify-end lg:col-span-1 lg:col-start-7 lg:row-start-1 lg:mt-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setRows((list) => list.filter((r) => r.key !== row.key))}
                  >
                    Leave out
                  </Button>
                </div>
              </fieldset>
              {state.row === row.key && state.error && <FieldError>{state.error}</FieldError>}
            </li>
          ))}
        </ul>
        <div className="border-t border-border px-4 py-2">
          <AddTrigger
            label="Add a course Dash missed"
            onClick={() => {
              const key = next.current++;
              setRows((list) => [...list, { key, course: BLANK, ownSchool: false }]);
            }}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="submit" pending={saving} disabled={count === 0 || discarding}>
          {saving ? 'Saving…' : count === 1 ? 'Save 1 course' : `Save ${count} courses`}
        </Button>
        <Button type="button" variant="ghost" onClick={discard} disabled={saving || discarding}>
          {discarding ? 'Discarding…' : 'Discard'}
        </Button>
      </div>
      {state.error && state.row === undefined && state.field !== 'school' && <FieldError>{state.error}</FieldError>}
    </form>
  );
}

/** One input of a course row: labelled above it on a phone, by the column header on a laptop. */
function Cell({
  label,
  name,
  value,
  max,
  required,
  inputMode,
  showLabel,
  className,
}: {
  label: string;
  name: string;
  value: string | number | null;
  max?: number;
  required?: boolean;
  inputMode?: 'numeric' | 'decimal';
  showLabel?: boolean;
  className?: string;
}) {
  return (
    <label className={cn('block min-w-0', className)}>
      <span className={cn('mb-0.5 block text-small text-ink-muted', !showLabel && 'lg:sr-only')}>{label}</span>
      <Input
        name={name}
        defaultValue={value ?? ''}
        maxLength={max}
        required={required}
        inputMode={inputMode}
        className="w-full"
      />
    </label>
  );
}

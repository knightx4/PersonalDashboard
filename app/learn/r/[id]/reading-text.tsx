'use client';

import { useRef, useState, useTransition, type ChangeEvent } from 'react';
import { ClipboardPaste, FileUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { FieldError, Textarea } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { createClient as createBrowserJobsClient } from '@/lib/jobs/auth/client';
import { APP_STORAGE_BUCKET } from '@/lib/jobs/db/schema-name';
import { readingPdfPath, readingPdfProblem } from '@/lib/learn/tracks/reading-pdf';
import { MAX_READING_TEXT } from '@/lib/learn/tracks/reading-text';
import { clearReadingText, saveReadingPdf, saveReadingText } from './actions';

/** Where this section sits, for the link under a summary that could not read the link. */
export const READING_TEXT_ANCHOR = 'reading-text';

/**
 * The text of a reading, when the link will not do (plan #1876.1).
 *
 * Paste it and it is kept on the reading; Dash reads it instead of the link
 * from then on. At rest the section says whether the reading is using text you
 * gave it and where that came from, and the text itself stays out of the page.
 * Replacing opens an empty box, since the old text is not sent back down.
 */
export function ReadingText({
  readingId,
  given,
  unreadable = false,
}: {
  readingId: string;
  given: { label: string; addedAt: string } | null;
  /** Summarize has just said the link cannot be read, so the buttons need no sentence of their own. */
  unreadable?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function open() {
    setDraft('');
    setError(null);
    setEditing(true);
  }

  function save() {
    setError(null);
    start(async () => {
      const formData = new FormData();
      formData.set('readingId', readingId);
      formData.set('text', draft);
      const result = await saveReadingText({}, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setEditing(false);
    });
  }

  // The PDF goes to storage from the browser first, so the file never rides in
  // the server action's one-megabyte body; the action reads it, keeps the
  // text and deletes the file.
  function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    setNotice(null);
    const problem = readingPdfProblem(file);
    if (problem) {
      setError(problem);
      return;
    }
    start(async () => {
      const supabase = createBrowserJobsClient();
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        setError('You are signed out. Sign in again to upload.');
        return;
      }
      const path = readingPdfPath(data.user.id, crypto.randomUUID());
      const { error: uploadError } = await supabase.storage
        .from(APP_STORAGE_BUCKET)
        .upload(path, file, { contentType: 'application/pdf', upsert: false });
      if (uploadError) {
        setError('That PDF could not be uploaded. Try again.');
        return;
      }
      const formData = new FormData();
      formData.set('readingId', readingId);
      formData.set('path', path);
      formData.set('name', file.name);
      const result = await saveReadingPdf({}, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setEditing(false);
      setNotice(result.notice ?? null);
    });
  }

  function clear() {
    setError(null);
    setNotice(null);
    start(async () => {
      const formData = new FormData();
      formData.set('readingId', readingId);
      const result = await clearReadingText({}, formData);
      if (result.error) setError(result.error);
    });
  }

  const over = draft.length > MAX_READING_TEXT;

  return (
    <section id={READING_TEXT_ANCHOR} className="mb-5 scroll-mt-4">
      <h2 className="mb-2 text-ui font-semibold text-ink-muted">Text of this reading</h2>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        tabIndex={-1}
        aria-label="Upload a PDF as the text of this reading"
        onChange={upload}
      />
      <div className={cn(cardVariants({ padding: 'dense' }), given || editing ? '' : 'border-dashed')}>
        {editing ? (
          <div className="space-y-2">
            <Textarea
              autoFocus
              rows={8}
              aria-label="The text of this reading"
              placeholder="Paste the text of the reading here."
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={pending}
            />
            <p className={cn('text-small', over ? 'text-danger' : 'text-ink-muted')}>
              {draft.length.toLocaleString('en-GB')} of {MAX_READING_TEXT.toLocaleString('en-GB')} characters
            </p>
            {error && <FieldError>{error}</FieldError>}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={save}
                disabled={pending || draft.trim() === '' || over}
              >
                {pending ? 'Saving…' : given ? 'Replace the text' : 'Keep the text'}
              </Button>
              <Button type="button" variant="ghost" size="md" onClick={() => setEditing(false)} disabled={pending}>
                Cancel
              </Button>
            </div>
          </div>
        ) : given ? (
          <div className="space-y-3">
            <p className="text-body text-ink">
              Dash reads the text you gave it, not the link.
            </p>
            <p className="text-ui text-ink-muted">
              {given.label}. Added {formatAdded(given.addedAt)}.
            </p>
            {notice && <p className="text-ui text-ink">{notice}</p>}
            {error && <FieldError>{error}</FieldError>}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="md" onClick={open} disabled={pending}>
                Replace the text
              </Button>
              <Button type="button" variant="secondary" size="md" onClick={() => fileRef.current?.click()} disabled={pending}>
                <FileUp className="size-4" strokeWidth={1.75} aria-hidden />
                {pending ? 'Reading the PDF…' : 'Upload a PDF'}
              </Button>
              <Button type="button" variant="ghost" size="md" className="px-0" onClick={clear} disabled={pending}>
                Clear the text
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {!unreadable && (
              <p className="text-body text-ink-muted">
                If Dash cannot open the link, paste the text of the reading or upload it as a PDF, and Dash reads that instead.
              </p>
            )}
            {error && <FieldError>{error}</FieldError>}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="md" onClick={open} disabled={pending}>
                <ClipboardPaste className="size-4" strokeWidth={1.75} aria-hidden />
                Paste the text
              </Button>
              <Button type="button" variant="secondary" size="md" onClick={() => fileRef.current?.click()} disabled={pending}>
                <FileUp className="size-4" strokeWidth={1.75} aria-hidden />
                {pending ? 'Reading the PDF…' : 'Upload a PDF'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function formatAdded(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

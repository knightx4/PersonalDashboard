'use client';

import { useState, useTransition } from 'react';
import { ClipboardPaste } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { FieldError, Textarea } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { MAX_READING_TEXT } from '@/lib/learn/tracks/reading-text';
import { clearReadingText, saveReadingText } from './actions';

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
}: {
  readingId: string;
  given: { label: string; addedAt: string } | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

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

  function clear() {
    setError(null);
    start(async () => {
      const formData = new FormData();
      formData.set('readingId', readingId);
      const result = await clearReadingText({}, formData);
      if (result.error) setError(result.error);
    });
  }

  const over = draft.length > MAX_READING_TEXT;

  return (
    <section className="mb-5">
      <h2 className="mb-2 text-ui font-semibold text-ink-muted">Text of this reading</h2>
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
            {error && <FieldError>{error}</FieldError>}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="md" onClick={open} disabled={pending}>
                Replace the text
              </Button>
              <Button type="button" variant="ghost" size="md" onClick={clear} disabled={pending}>
                {pending ? 'Clearing…' : 'Clear the text'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-body text-ink-muted">
              If Dash cannot open the link, paste the text of the reading and it reads that instead.
            </p>
            <Button type="button" variant="secondary" size="md" onClick={open}>
              <ClipboardPaste className="size-4" strokeWidth={2} aria-hidden />
              Paste the text
            </Button>
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

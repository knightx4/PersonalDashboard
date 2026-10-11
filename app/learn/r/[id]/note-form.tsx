'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { Textarea } from '@/components/ui/field';
import { updateNote, type ReadingActionState } from './actions';

/**
 * What you took from it.
 *
 * One optional field, and the first thing this application stores about what
 * somebody learned rather than about what they did. Everything the module is
 * eventually for -- knowing where you already are, so it can stop suggesting
 * the basics -- starts as a pile of these.
 *
 * Optional on purpose. A note the app nags for is a note written to satisfy
 * the app.
 */

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" size="sm" disabled={pending}>
      {pending ? 'Saving…' : 'Save'}
    </Button>
  );
}

/**
 * The note reads as plain text and opens for editing when pressed (plan
 * #1770). Save and Cancel exist only while editing, so a page that is being
 * read carries no form chrome.
 */
export function NoteForm({ readingId, note }: { readingId: string; note: string | null }) {
  const [editing, setEditing] = useState(false);
  // What was last saved here, shown until the revalidated page brings it back.
  const [saved, setSaved] = useState<string | null>(null);
  const shown = saved ?? note ?? '';

  const [state, formAction] = useActionState<ReadingActionState, FormData>(async (prev, formData) => {
    const result = await updateNote(prev, formData);
    if (!result.error) {
      setSaved(String(formData.get('note') ?? ''));
      setEditing(false);
    }
    return result;
  }, {});

  if (!editing) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="What you took from this reading"
          className={cn(
            'block w-full whitespace-pre-wrap rounded-control border border-border bg-sunken px-3 py-2 text-left text-body hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
            shown.trim() ? 'text-ink' : 'text-ink-muted',
          )}
        >
          {shown.trim() ? shown : 'The one thing worth remembering.'}
        </button>
      </div>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="readingId" value={readingId} />
      <Textarea
        name="note"
        defaultValue={shown}
        rows={4}
        autoFocus
        placeholder="The one thing worth remembering."
        aria-label="What you took from this reading"
      />
      <div className="mt-2 flex items-center gap-2">
        <SaveButton />
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
          Cancel
        </Button>
        {state.error && <span className="text-ui text-danger">{state.error}</span>}
      </div>
    </form>
  );
}

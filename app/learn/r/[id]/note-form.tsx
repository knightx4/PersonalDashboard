'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
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

function SaveButton({ dirty }: { dirty: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" size="sm" disabled={pending || !dirty}>
      {pending ? 'Saving…' : 'Save'}
    </Button>
  );
}

export function NoteForm({ readingId, note }: { readingId: string; note: string | null }) {
  const [state, formAction] = useActionState<ReadingActionState, FormData>(updateNote, {});

  return (
    <form action={formAction}>
      <input type="hidden" name="readingId" value={readingId} />
      <Textarea
        name="note"
        defaultValue={note ?? ''}
        rows={4}
        placeholder="The one thing worth remembering."
        aria-label="What you took from this reading"
      />
      <div className="mt-2 flex items-center gap-3">
        <SaveButton dirty />
        {state.error && <span className="text-ui text-danger">{state.error}</span>}
      </div>
    </form>
  );
}

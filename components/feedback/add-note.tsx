'use client';

import { useActionState, useEffect, useState } from 'react';
import { submitFeedback, triageFiled, type FeedbackActionState } from '@/app/dev/bugs/actions';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { FieldError, Textarea } from '@/components/ui/field';

/**
 * File a note from the queue itself (note 0769242a), as the header button
 * does from every other page. The same action saves it, as a request until
 * triage says it is a bug, and the same triage runs once it has saved, so a
 * note filed here is sorted and moved to the ideas page exactly as one filed
 * from the header is.
 *
 * Closed until asked for (law 14), like Add an idea next door: the queue is
 * read far more often than it is written to. No page path is saved with it,
 * since "/dev/bugs" says nothing about where the problem is.
 */
export function AddNote() {
  const [state, action, pending] = useActionState(submitFeedback, {} as FeedbackActionState);
  const [composing, setComposing] = useState(false);

  // Close once it has saved. The note appearing in the list below is the
  // confirmation. Adjusted during render, as Add an idea does.
  const [seen, setSeen] = useState<FeedbackActionState | null>(null);
  if (state !== seen) {
    setSeen(state);
    if (state.filed) setComposing(false);
  }

  // Triage what was just saved, as the header panel does once its save has
  // returned, so saving never waits on Jev. Its answer lands in the list.
  const filedId = state.filed?.id ?? null;
  useEffect(() => {
    if (!filedId) return;
    void triageFiled({ table: 'feedback_items', id: filedId, pagePath: '/dev/bugs' }).catch(
      () => {},
    );
  }, [filedId]);

  if (!composing) {
    return <AddTrigger label="Add a note" onClick={() => setComposing(true)} />;
  }

  return (
    <form action={action} className={cardVariants({ padding: 'dense' })}>
      <input type="hidden" name="kind" value="feature" />
      <Textarea
        id="note-body"
        name="body"
        rows={3}
        autoFocus
        required
        placeholder="A bug, a change, or an idea. Dash sorts it once it is saved."
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" pending={pending}>
          {pending ? 'Saving…' : 'Add note'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setComposing(false)}>
          Cancel
        </Button>
        <FieldError>{state.error}</FieldError>
      </div>
    </form>
  );
}

'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { addToTrack, type TrackActionState } from './actions';

/**
 * Adding one specific thing to a track.
 *
 * One line, always visible at the foot of the list, because the moment you
 * think of something is the moment it has to be cheap to write down. A button
 * that opens a form that has a field is three actions where one will do, and
 * the thought is gone by the third.
 *
 * No source, no search, no confirm step. You typed it; it is yours.
 */

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" size="sm" disabled={pending}>
      <Plus className="size-4" strokeWidth={2} aria-hidden />
      {pending ? 'Adding…' : 'Add'}
    </Button>
  );
}

export function AddForm({ trackId }: { trackId: string }) {
  const [state, formAction] = useActionState<TrackActionState, FormData>(addToTrack, {});
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Clear and refocus after a successful add, so a run of five things is five
  // sentences rather than five round trips to the mouse.
  useEffect(() => {
    if (!state.error) {
      formRef.current?.reset();
      inputRef.current?.focus();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="mt-3">
      <input type="hidden" name="trackId" value={trackId} />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          ref={inputRef}
          name="title"
          required
          maxLength={500}
          placeholder="Something specific you want to learn"
          aria-label="Something specific you want to learn"
          className="min-w-0 flex-1"
        />
        <AddButton />
      </div>
      {state.error && <p className="mt-2 text-ui text-danger">{state.error}</p>}
    </form>
  );
}

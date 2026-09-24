'use client';

import { useActionState, useState } from 'react';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { addChannelAction, type PressState } from './actions';

/**
 * Following a channel: a line until pressed, then one field.
 *
 * The first listing of a big channel reads thousands of videos and every
 * playlist, which can take a few minutes, so the button says so while it runs.
 */
export function AddChannel() {
  const [state, add, pending] = useActionState<PressState, FormData>(addChannelAction, {});
  const [open, setOpen] = useState(false);

  if (!open && !state.message && !state.error) {
    return <AddTrigger label="Follow a channel" onClick={() => setOpen(true)} />;
  }

  return (
    <form action={add} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          name="channel"
          required
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="@MITOCW, or a link to the channel"
          aria-label="Channel handle or link"
          className="max-w-sm flex-1"
        />
        <Button type="submit" pending={pending}>
          {pending ? 'Listing videos and playlists…' : 'Follow'}
        </Button>
        {!pending && (
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        )}
      </div>
      {state.error ? (
        <p role="alert" className="text-small text-danger">
          {state.error}
        </p>
      ) : state.message ? (
        <p aria-live="polite" className="text-small text-ink-muted">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

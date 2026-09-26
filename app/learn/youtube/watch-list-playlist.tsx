'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { setWatchListPlaylistAction, type PressState } from './actions';

/**
 * The playlist your list is read from (plan #1065): one field, kept in Learn
 * settings. Saving reads the playlist straight away.
 */
export function WatchListPlaylist({ current }: { current: string | null }) {
  const [state, save, pending] = useActionState<PressState, FormData>(setWatchListPlaylistAction, {});

  return (
    <form action={save} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          name="playlist"
          defaultValue={current ?? ''}
          autoComplete="off"
          spellCheck={false}
          placeholder="https://www.youtube.com/playlist?list=…"
          aria-label="Link to your playlist"
          className="max-w-md flex-1"
        />
        <Button type="submit" pending={pending}>
          {pending ? 'Reading the playlist…' : 'Save'}
        </Button>
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

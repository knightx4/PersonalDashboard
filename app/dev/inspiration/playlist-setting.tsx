'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FieldError, Input } from '@/components/ui/field';
import { playlistUrl } from '@/lib/dev/inspiration/view';
import { setInspirationPlaylist, type InspirationActionState } from './actions';

/**
 * Which playlist the tab reads, as a link, and the one move that changes it.
 *
 * The link is the value at rest and the field only appears on Change, so the
 * page leads with what it is reading rather than with a box asking for it.
 * With no playlist set the field is open from the start, since there is
 * nothing else to show.
 */
export function PlaylistSetting({ playlistId }: { playlistId: string | null }) {
  const [editing, setEditing] = useState(playlistId === null);
  const [state, action, pending] = useActionState(setInspirationPlaylist, {} as InspirationActionState);

  // A save that worked closes the field; the page has the new link by then.
  // Adjusted while rendering rather than in an effect, so there is no frame
  // with the field still open over the saved link.
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    if (state.message) setEditing(false);
  }

  if (!editing && playlistId) {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-ink-muted">
        <span>
          Reading{' '}
          <a
            href={playlistUrl(playlistId)}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-ink underline decoration-ink-ghost underline-offset-2 hover:decoration-ink"
          >
            your playlist ({playlistId})
          </a>
        </span>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
          Change
        </Button>
        {state.message && <span role="status">{state.message}</span>}
      </p>
    );
  }

  return (
    <form action={action} className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          name="playlist"
          defaultValue={playlistId ? playlistUrl(playlistId) : ''}
          placeholder="https://www.youtube.com/playlist?list=…"
          aria-label="Link to the YouTube playlist"
          className="min-w-0 flex-1 basis-64"
          autoFocus={playlistId !== null}
        />
        <Button type="submit" pending={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        {playlistId && (
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
      </div>
      <FieldError>{state.error}</FieldError>
    </form>
  );
}

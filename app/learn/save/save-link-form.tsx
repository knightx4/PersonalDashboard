'use client';

import { useActionState, useEffect, useRef } from 'react';
import Link, { linkVariants } from '@/components/ui/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { saveReadingLink, type SaveLinkState } from './actions';

/**
 * One field for saving a link to read later. Paste and press Enter: the page's
 * title is read from the page, the reading goes on "Saved links", and the
 * field clears for the next one. Used on Reading lists and on /learn/save.
 */
export function SaveLinkForm({ autoFocus = false }: { autoFocus?: boolean }) {
  const [state, formAction, pending] = useActionState<SaveLinkState, FormData>(saveReadingLink, { status: 'idle' });
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.status === 'saved' && input.current) input.current.value = '';
  }, [state]);

  return (
    <form action={formAction} className="max-w-md">
      <div className="flex gap-2">
        <Input
          ref={input}
          name="url"
          type="url"
          inputMode="url"
          required
          autoFocus={autoFocus}
          placeholder="Paste a link to read later"
          aria-label="Link to save to your reading list"
          aria-invalid={state.status === 'error' || undefined}
          className="min-h-11 sm:min-h-0"
        />
        <Button type="submit" variant="secondary" pending={pending} className="min-h-11 sm:min-h-0">
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <SaveLinkResult state={state} />
    </form>
  );
}

/** What the last save did: saved, already there, or why it did not. */
export function SaveLinkResult({ state }: { state: SaveLinkState }) {
  if (state.status === 'error') return <p className="mt-1.5 text-small text-danger">{state.error}</p>;
  if (state.status !== 'saved') return null;
  return (
    <p className="mt-1.5 text-small text-ink-muted" role="status">
      {state.created ? 'Saved to Saved links: ' : 'Already on your reading lists: '}
      <Link href={`/learn/r/${state.readingId}`} className={linkVariants()}>
        {state.title}
      </Link>
    </p>
  );
}

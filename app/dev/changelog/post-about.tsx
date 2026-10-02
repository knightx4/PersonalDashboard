'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { suggestPostAbout, type PostsActionState } from '../posts/actions';

/**
 * Post about this (plan #1420): start a Dash run that drafts one X post about
 * this one step. The draft lands on the Posts tab, which the confirmation
 * links to; Dash never posts it.
 *
 * Only drawn on a line a post may come from (the changelog decides with the
 * source check), and the action checks again, so a refusal here is the run
 * already going or a draft about this step already waiting.
 */
export function PostAbout({ number }: { number: number }) {
  const [state, action, pending] = useActionState(suggestPostAbout, {} as PostsActionState);

  return (
    <form action={action} className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <input type="hidden" name="number" value={number} />
      <Button type="submit" variant="ghost" size="sm" pending={pending} className="-ml-2.5">
        {pending ? 'Sending…' : 'Post about this'}
      </Button>
      {state.message && (
        <p role="status" className="text-small text-ink-muted">
          {state.message}{' '}
          <Link href="/dev/posts" className="text-accent hover:underline">
            Open Posts
          </Link>
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-small text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}

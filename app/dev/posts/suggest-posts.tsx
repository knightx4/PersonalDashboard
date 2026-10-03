'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { ComposeBody, ComposeBox } from '@/components/ui/field';
import { MAX_POST_ASK, type PostsRunState } from '@/lib/dev/posts';
import { suggestPosts, type PostsActionState } from './actions';

/**
 * Suggest posts (plan #1419): start a Dash run that drafts three to five X
 * posts about what shipped since the last posted one.
 *
 * While a run is going the button is held off and says so, and the page
 * refreshes itself every fifteen seconds, which is how the drafts appear
 * without a reload. A run counts as going for 45 minutes at most
 * (POSTS_RUN_HOLD_MINUTES), after which the button is live again and the
 * line under the heading says the run did not finish.
 */
export function SuggestPosts({ runState }: { runState: PostsRunState }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(suggestPosts, {} as PostsActionState);
  const going = runState === 'going';

  useEffect(() => {
    if (!going) return;
    const timer = window.setInterval(() => router.refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [going, router]);

  const busy = pending || going;
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <Button type="submit" variant="secondary" pending={busy}>
        {pending ? 'Sending…' : going ? 'Dash is drafting…' : 'Suggest posts'}
      </Button>
      {state.error && (
        <p role="alert" className="text-small text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}

/**
 * Ask for a post about something in particular (note 114ff495): a line under
 * the heading that opens a box to type it in. Sent through the same action as
 * Suggest posts, so it is held off while a run is going for the same reason.
 */
export function AskForPost({ runState }: { runState: PostsRunState }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    async (prev: PostsActionState, formData: FormData) => {
      const next = await suggestPosts(prev, formData);
      if (!next.error) setOpen(false);
      return next;
    },
    {} as PostsActionState,
  );
  const going = runState === 'going';

  if (!open) {
    return (
      <AddTrigger label="Ask for a post about…" onClick={() => setOpen(true)} disabled={going} />
    );
  }
  return (
    <form action={action} className="space-y-1">
      <ComposeBox>
        <ComposeBody
          name="ask"
          required
          autoFocus
          maxLength={MAX_POST_ASK}
          rows={2}
          aria-label="What the post should be about"
          placeholder="What should the post be about?"
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" size="sm" pending={pending || going}>
            {pending ? 'Sending…' : 'Draft it'}
          </Button>
        </div>
      </ComposeBox>
      {state.error && (
        <p role="alert" className="text-small text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}

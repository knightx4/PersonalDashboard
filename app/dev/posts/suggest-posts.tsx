'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import type { PostsRunState } from '@/lib/dev/posts';
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
  const [state, action, pending] = useActionState(
    async () => suggestPosts(),
    {} as PostsActionState,
  );
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

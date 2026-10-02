'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { checkInspirationNow, type InspirationActionState } from './actions';

/**
 * Check now (plan #1411): read the playlist and any new videos without waiting
 * for the daily run.
 *
 * The check goes on after the press returns, so while one is going (from this
 * button or the daily run) the button says so and the page refreshes itself
 * every ten seconds, which is how new takeaways appear without a reload.
 */
export function CheckNow({ checking }: { checking: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    async () => checkInspirationNow(),
    {} as InspirationActionState,
  );

  useEffect(() => {
    if (!checking) return;
    const timer = window.setInterval(() => router.refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [checking, router]);

  const busy = pending || checking;
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <Button type="submit" variant="secondary" pending={busy}>
        {busy ? 'Checking…' : 'Check now'}
      </Button>
      {state.error && (
        <p role="alert" className="text-small text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}

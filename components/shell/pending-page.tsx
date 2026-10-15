'use client';

import { useEffect, useState } from 'react';
import { ReadingPageSkeleton } from '@/components/ui/skeleton';
import { useNavigationPending } from '@/lib/core/navigation-pending';

/**
 * The page, or a loading screen in its place while a link to another page
 * waits on the server (lib/core/navigation-pending.ts). It waits 100ms first,
 * as the link's dim does, so a quick navigation never flashes it. The page
 * stays mounted underneath, so a navigation that is abandoned leaves it as it
 * was.
 */
export function PendingPage({ children }: { children: React.ReactNode }) {
  const pending = useNavigationPending();
  const [waited, setWaited] = useState(false);
  const showing = pending && waited;

  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setWaited(true), 100);
    return () => {
      clearTimeout(timer);
      setWaited(false);
    };
  }, [pending]);

  return (
    <>
      {showing && (
        <div role="status" aria-label="Loading">
          <ReadingPageSkeleton />
        </div>
      )}
      <div className={showing ? 'hidden' : 'contents'}>
        {children}
      </div>
    </>
  );
}

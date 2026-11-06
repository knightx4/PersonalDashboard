'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { keepCurrent } from '@/lib/share/keep-current';

/**
 * Renders nothing. While the shared page is open it asks the server for the
 * page again on focus, on the tab coming back, and every minute while visible,
 * so a change made on the owner's side shows without a reload. A refresh keeps
 * the form's client state, and a link revoked meanwhile renders the same
 * not-found as any other bad token.
 */
export function KeepCurrent() {
  const router = useRouter();
  useEffect(
    () =>
      keepCurrent(
        {
          addEventListener: (t, f) => window.addEventListener(t, f),
          removeEventListener: (t, f) => window.removeEventListener(t, f),
          setInterval: (f, ms) => window.setInterval(f, ms),
          clearInterval: (id) => window.clearInterval(id),
        },
        document,
        () => router.refresh(),
      ),
    [router],
  );
  return null;
}

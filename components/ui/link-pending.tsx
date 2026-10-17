'use client';

import { useEffect } from 'react';
import { useLinkStatus } from 'next/link';
import { holdNavigation, linkPathname } from '@/lib/core/navigation-pending';

/**
 * Put inside a `next/link` to hold the link in its pressed state while its
 * page is on the way (plan #1444). `press` scales a control while the finger
 * is down; this carries on from there until the page arrives, so a tap on a
 * phone that waits for the server still shows it landed.
 *
 * It renders nothing visible. The styling is in globals.css, on the link
 * that contains it (`:has([data-link-pending])`): after 100ms the link dims
 * and pulses, so a navigation that is quick never flickers. A dim rather than
 * a spinner: the app shows waiting as skeletons, not spinners, and a spinner
 * beside a dock icon or a row name would push what is next to it.
 *
 * Given the link's `href`, a link to another page also puts the shell's
 * loading screen up while it waits (lib/core/navigation-pending.ts), so the
 * page answers the click even when the server is slow to.
 *
 * Next skips the pending state for a route it has already prefetched, which
 * is the case where nothing is needed anyway.
 */
export function LinkPending({ href }: { href?: unknown }) {
  const { pending } = useLinkStatus();
  const target = linkPathname(href);

  useEffect(() => {
    if (!pending || target === null || target === window.location.pathname) return;
    return holdNavigation();
  }, [pending, target]);

  return <span hidden data-link-pending={pending ? '' : undefined} />;
}

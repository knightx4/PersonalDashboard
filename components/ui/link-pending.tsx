'use client';

import { useLinkStatus } from 'next/link';

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
 * Next skips the pending state for a route it has already prefetched, which
 * is the case where nothing is needed anyway.
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  return <span hidden data-link-pending={pending ? '' : undefined} />;
}

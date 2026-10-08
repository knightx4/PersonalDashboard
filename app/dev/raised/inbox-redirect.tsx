'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Sends a link written before the Inbox tab on to it.
 *
 * Notifications, comments, summaries and agenda rows written before the
 * waiting list moved say `/dev/raised#raise-…` or `#waiting-…`, and those
 * rows are on /dev/inbox now. The fragment never reaches the server, so the
 * move has to be made here, in the browser, once the page has the hash.
 */
export function InboxRedirect() {
  const router = useRouter();
  useEffect(() => {
    const hash = window.location.hash;
    if (/^#(raise|waiting)-/.test(hash)) router.replace(`/dev/inbox${hash}`);
  }, [router]);
  return null;
}

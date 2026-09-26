'use client';

import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { gmailIdFromHref, isMobileBrowser } from '@/lib/email/gmail-open';

/**
 * An `<a>` to a Gmail conversation that also works on a phone.
 *
 * The web link opens the conversation on a desktop, but mobile Gmail, in the
 * browser and in the app, ignores the part that names it and shows the inbox.
 * Google offers no phone link that does better. So on a phone this opens the
 * conversation in the dashboard's own reader at /mail/<id> instead.
 */
export function GmailAnchor({
  href,
  onClick,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const router = useRouter();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (!isMobileBrowser(navigator.userAgent, navigator.maxTouchPoints)) return;
    const id = gmailIdFromHref(href);
    if (!id) return;
    event.preventDefault();
    router.push(`/mail/${id}`);
  }

  return <a href={href} onClick={handleClick} {...rest} />;
}

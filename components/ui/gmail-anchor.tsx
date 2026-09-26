'use client';

import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { gmailAppUrl, isIOS } from '@/lib/email/gmail-open';

/**
 * An `<a>` to a Gmail conversation that also works on an iPhone.
 *
 * The web link opens the conversation on a desktop, but mobile Gmail ignores
 * the part that names it and shows the inbox. On iOS this hands the tap to the
 * Gmail app instead, and falls back to the web link if the page is still in
 * front a moment later, which is what happens when the app is not installed.
 */
export function GmailAnchor({
  href,
  onClick,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (!isIOS(navigator.userAgent, navigator.maxTouchPoints)) return;
    const appHref = gmailAppUrl(href);
    if (!appHref) return;

    event.preventDefault();
    const fallback = window.setTimeout(() => {
      if (document.visibilityState === 'visible') window.location.href = href;
    }, 1500);
    const cancel = () => {
      if (document.visibilityState === 'hidden') window.clearTimeout(fallback);
    };
    document.addEventListener('visibilitychange', cancel, { once: true });
    window.addEventListener('pagehide', () => window.clearTimeout(fallback), { once: true });
    window.location.href = appHref;
  }

  return <a href={href} onClick={handleClick} {...rest} />;
}

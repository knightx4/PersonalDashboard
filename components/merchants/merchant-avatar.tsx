'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';
import {
  merchantFaviconUrl,
  merchantInitials,
  primaryMerchantDomain,
} from '@/lib/merchants/avatar';

export function MerchantAvatar({
  name,
  logoUrl,
  domains,
  className,
}: {
  name: string;
  logoUrl?: string | null;
  domains?: readonly string[] | null;
  className?: string;
}) {
  const domain = primaryMerchantDomain(domains);
  const remote = logoUrl?.trim() || (domain ? merchantFaviconUrl(domain) : null);
  const [failed, setFailed] = useState(false);
  const initials = merchantInitials(name);

  // A filled tile rather than an outlined one. The hairline was there to stop
  // a white favicon bleeding into a white card -- a real problem, and not one
  // a frame is the answer to. A recessed ground solves it and adds no second
  // edge inside the card the avatar sits in (law 11), and it is `sunken`
  // rather than `canvas` because canvas is the page colour in three of the
  // four themes and so would have vanished on every page that is not a card.
  return (
    <span
      className={cn(
        'relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-card bg-sunken text-small font-semibold tracking-wide text-ink-muted',
        className,
      )}
      aria-hidden
    >
      {remote && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- favicon / merchant CDNs
        <img
          src={remote}
          alt=""
          className="size-7 object-contain"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{initials}</span>
      )}
    </span>
  );
}

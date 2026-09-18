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

  // Null once the load has failed, so one value decides both the ground and
  // whether the <img> renders at all -- they cannot disagree.
  const shownSrc = failed ? null : remote;

  // A filled tile rather than an outlined one. The hairline was there to stop
  // a white favicon bleeding into a white card -- a real problem, and not one
  // a frame is the answer to. A recessed ground solves it and adds no second
  // edge inside the card the avatar sits in (law 11), and it is `sunken`
  // rather than `canvas` because canvas is the page colour in three of the
  // four themes and so would have vanished on every page that is not a card.
  //
  // White, though, whenever a real favicon is showing: those are drawn for a
  // white page and shipped transparent, so dark ink on a dark tile was
  // invisible in the dark themes. Same reasoning as CompanyAvatar -- it is
  // the paper the asset expects, not a theme colour.
  return (
    <span
      className={cn(
        'relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-card text-small font-semibold tracking-wide text-ink-muted',
        shownSrc ? 'bg-white' : 'bg-sunken',
        className,
      )}
      aria-hidden
    >
      {shownSrc ? (
        // eslint-disable-next-line @next/next/no-img-element -- favicon / merchant CDNs
        <img
          src={shownSrc}
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

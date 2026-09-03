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

  return (
    <span
      className={cn(
        'relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-canvas text-small font-semibold tracking-wide text-ink-muted',
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

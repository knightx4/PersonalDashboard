'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';
import {
  companyAvatarSrc,
  companyInitials,
  type CompanyAvatarSource,
} from '@/lib/jobs/companies/avatar';

/**
 * A company's mark, wherever its name appears.
 *
 * Client-side because of `onError`: a stored `logo_url` points at a company's
 * own site and those rot — a redesign moves the icon and the row is left
 * pointing at a 404. Falling back to initials on the failed load keeps a dead
 * URL looking like a company without a logo rather than like a broken page.
 *
 * `aria-hidden`, always: the name is next to it in every place this is used,
 * and announcing "Ramp" twice is worse than not announcing the logo at all.
 */
export function CompanyAvatar({
  company,
  className,
  imageClassName,
}: {
  company: CompanyAvatarSource;
  className?: string;
  imageClassName?: string;
}) {
  const src = companyAvatarSrc(company);
  const [failed, setFailed] = useState(false);

  return (
    <span
      className={cn(
        'relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-canvas text-micro font-semibold tracking-wide text-ink-muted',
        className,
      )}
      aria-hidden
    >
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- third-party favicon and company CDNs, no loader
        <img
          src={src}
          alt=""
          className={cn('size-5 object-contain', imageClassName)}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{companyInitials(company.name)}</span>
      )}
    </span>
  );
}

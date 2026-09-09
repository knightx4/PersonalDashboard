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

  // Null once the load has failed, so one value decides both the ground and
  // whether the <img> renders at all -- they cannot disagree.
  const shownSrc = failed ? null : src;

  return (
    // A filled tile rather than an outlined one. The border was here to stop a
    // logo on a white ground from bleeding into the card behind it, which is a
    // real problem and not one a frame is the answer to: a ground solves it and
    // does not add an eleventh hairline to a list of ten rows. `sunken` rather
    // than `canvas` because canvas is the page colour in three of the four
    // themes, so a canvas tile on a page was a tile you could not see.
    //
    // The ground is literal white when a logo is actually showing, and only
    // then. Company marks are drawn for a white page and shipped with a
    // transparent background, so dark ink on a dark `sunken` tile disappeared
    // entirely in the dark themes. This is not a theme colour and must not
    // become one: it is the paper the asset was drawn on. The initials
    // fallback is our own type, so it keeps the themed ground.
    <span
      className={cn(
        'relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-control text-micro font-semibold tracking-wide text-ink-muted',
        shownSrc ? 'bg-white' : 'bg-sunken',
        className,
      )}
      aria-hidden
    >
      {shownSrc ? (
        // eslint-disable-next-line @next/next/no-img-element -- third-party favicon and company CDNs, no loader
        <img
          src={shownSrc}
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

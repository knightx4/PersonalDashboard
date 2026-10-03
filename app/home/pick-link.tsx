'use client';

import Link from '@/components/ui/link';
import type { ReactNode } from 'react';
import { openBriefPick } from './actions';

/**
 * A pick's link on the morning brief, which records that it was followed
 * (plan #1242) as it navigates. The record is sent and not waited for, so the
 * link is as quick as a plain one.
 */
export function PickLink({
  day,
  pickKey,
  href,
  className,
  children,
}: {
  day: string;
  pickKey: string;
  href: string;
  className?: string;
  children: ReactNode;
}) {
  function record() {
    void openBriefPick(day, pickKey).catch(() => undefined);
  }

  return (
    <Link
      href={href}
      className={className}
      onClick={record}
      onAuxClick={(event) => {
        // A middle-click opens the pick in a new tab, which is following it too.
        if (event.button === 1) record();
      }}
    >
      {children}
    </Link>
  );
}

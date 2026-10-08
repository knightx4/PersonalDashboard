'use client';

import { useState } from 'react';
import { DashMark } from '@/components/ui/dash-mark';
import { usePerson } from '@/components/shell/person';
import { cn } from '@/lib/cn';

/** Who a step is on: you, Dash, or some of each beneath it. */
export type Assignee = 'me' | 'dash' | 'both';

/**
 * Who holds a step, as a small circle in the row's assignee column: your
 * photo for yours, Dash's visor for Dash's, the two overlapping for a step
 * with some of each beneath it. While a Dash run is going on the step the
 * visor races, so the circle also says Dash is on it now.
 *
 * The name is the circle's accessible label and tooltip, so a row read
 * aloud still says whose it is.
 */
export function AssigneeAvatar({
  who,
  working = false,
  title,
  className,
}: {
  who: Assignee;
  working?: boolean;
  /** The tooltip. Left out, it names who. */
  title?: string;
  className?: string;
}) {
  const person = usePerson();
  const name =
    who === 'me' ? person.name : who === 'dash' ? 'Dash' : `${person.name} and Dash`;
  return (
    <span
      role="img"
      aria-label={working ? `${name}, Dash is on it` : name}
      title={title ?? name}
      className={cn('inline-flex shrink-0 items-center', className)}
    >
      {who !== 'dash' && <PersonCircle />}
      {who !== 'me' && <DashCircle working={working} overlap={who === 'both'} />}
    </span>
  );
}

const CIRCLE = 'flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full';

function PersonCircle() {
  const person = usePerson();
  const [failed, setFailed] = useState(false);
  const src = failed ? null : person.avatarUrl;
  return (
    <span className={cn(CIRCLE, 'bg-accent-tint text-micro font-semibold text-accent')} aria-hidden>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- the sign-in provider's photo, no loader
        <img
          src={src}
          alt=""
          className="size-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        person.name.charAt(0).toUpperCase()
      )}
    </span>
  );
}

function DashCircle({ working, overlap }: { working: boolean; overlap: boolean }) {
  return (
    <span
      className={cn(CIRCLE, 'bg-sunken text-ink-muted', overlap && '-ml-2 ring-2 ring-surface')}
      aria-hidden
    >
      <DashMark size="2xs" tone="brand" state={working ? 'working' : 'idle'} decorative />
    </span>
  );
}

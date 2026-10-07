'use client';

import { Equal, EqualNot } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { DashMark } from '@/components/ui/dash-mark';
import { PaidHint } from '@/components/ui/paid-hint';
import { cn } from '@/lib/cn';
import { formatDay } from '@/lib/goals/dates';
import { readCount, type PersonalityRead, type ReadStatus } from '@/lib/learn/personality/model';
import { noteHref } from '@/lib/vault/paths';
import { readAgainAction } from './personality/actions';

/**
 * Dash's read of one personality result against your notes (plan #1635):
 * where the test agrees with what you wrote about yourself and where it
 * clashes, clashes first, each point naming the note it rests on with a link
 * to it. Under it, a button for a fresh read.
 *
 * While the read that follows a save is still running the page looks again
 * every few seconds, for a couple of minutes, so it appears without a reload.
 */

/** How often a waiting read is looked for, and for how many looks. */
const POLL_MS = 8_000;
const POLL_TIMES = 15;

const STATUS_LINE: Record<Exclude<ReadStatus, 'ready'>, string> = {
  pending: 'Dash is reading this against your notes. It shows here when it is done.',
  failed: 'Dash’s read did not run.',
  none: 'Dash has not read this against your notes yet.',
};

export function PersonalityReadPanel({
  resultId,
  read,
  status,
  title = 'Dash’s read',
}: {
  resultId: string;
  read: PersonalityRead | null;
  status: ReadStatus;
  /** The heading, when the panel sits under something other than the traits. */
  title?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'pending') return;
    let looks = 0;
    const timer = window.setInterval(() => {
      looks += 1;
      if (looks > POLL_TIMES) window.clearInterval(timer);
      else router.refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [status, router]);

  function readAgain() {
    setError(null);
    startTransition(async () => {
      const outcome = await readAgainAction(resultId);
      if ('error' in outcome) setError(outcome.error);
      router.refresh();
    });
  }

  const working = pending || status === 'pending';
  const points = read?.points ?? [];

  return (
    <section aria-label={title} className="space-y-3">
      <div className="flex items-center gap-2">
        <DashMark
          size="icon"
          decorative
          state={working ? 'working' : status === 'failed' ? 'failed' : 'idle'}
          className={status === 'failed' && !working ? 'text-danger' : 'text-ink-muted'}
        />
        <h3 className="text-body font-medium text-ink">{title}</h3>
        {read && points.length > 0 ? (
          <span className="text-small text-ink-muted">{readCount(points)}</span>
        ) : null}
      </div>

      {status !== 'ready' ? (
        <p className={cn('text-ui', status === 'failed' ? 'text-danger' : 'text-ink-muted')}>
          {STATUS_LINE[status]}
          {status === 'failed' && read ? ' The read below is the earlier one.' : ''}
        </p>
      ) : null}

      {read && points.length === 0 ? (
        <p className="text-ui text-ink-muted">
          Your notes say too little about you for Dash to set beside this.
        </p>
      ) : null}

      {points.length > 0 ? (
        <ul className="space-y-3">
          {points.map((point, i) => (
            <li key={`${point.note.id}-${i}`} className="flex gap-2">
              {point.stance === 'clashes' ? (
                <EqualNot aria-hidden strokeWidth={2} className="mt-1 size-4 shrink-0 text-ink" />
              ) : (
                <Equal aria-hidden strokeWidth={2} className="mt-1 size-4 shrink-0 text-ink" />
              )}
              <div className="min-w-0">
                <p className="text-body text-ink">
                  <span className="text-ink-muted">
                    {point.stance === 'clashes' ? 'Clashes' : 'Agrees'} ·{' '}
                  </span>
                  {point.text}
                </p>
                <p className="mt-0.5 text-small text-ink-muted">
                  From{' '}
                  <Link
                    href={noteHref(point.note.path)}
                    className="break-words text-ink underline decoration-border underline-offset-2 hover:decoration-ink"
                  >
                    {point.note.title}
                  </Link>
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {status !== 'pending' ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1">
            <Button variant="secondary" size="sm" onClick={readAgain} pending={pending}>
              {pending ? 'Reading…' : read ? 'Read again' : status === 'failed' ? 'Try again' : 'Ask Dash to read it'}
            </Button>
            <PaidHint
              action="app/learn/know/personality/actions.ts#readAgainAction"
              what="Cost of a fresh read from Dash"
            />
          </span>
          {read ? (
            <span className="text-small text-ink-muted">Read {formatDay(read.at.slice(0, 10), true)}</span>
          ) : null}
          {error ? <span className="text-small text-danger">{error}</span> : null}
        </div>
      ) : null}
    </section>
  );
}

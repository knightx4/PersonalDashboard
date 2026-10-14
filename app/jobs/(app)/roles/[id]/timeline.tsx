'use client';

import { useEffect, useRef } from 'react';
import { CircleAlert, ListChecks } from 'lucide-react';
import { cn } from '@/lib/cn';
import { CardSection, cardVariants } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/jobs/ui/status-badge';
import { formatDate } from '@/lib/jobs/applications/load';
import { safeTimeZone } from '@/lib/core/timezone';
import { whenDate } from '@/lib/core/when';
import { GmailLink } from './shared';
import type { PanelProps } from './types';

export function Timeline({ events, timezone, otherAttempts }: PanelProps) {
  return (
    <div className="space-y-4">
      {otherAttempts.length > 0 && (
        <CardSection
          title="Earlier attempts"
          hint="Kept as history rather than overwritten — which is the whole reason a pursuit is a separate row from the posting."
        >
          <ul className="space-y-1.5">
            {otherAttempts.map((attempt) => (
              <li key={attempt.id} className="flex items-center gap-2 text-ui">
                <span className="tabular text-ink-muted">#{attempt.attempt}</span>
                <StatusBadge status={attempt.status} everSubmitted={attempt.submittedAt !== null} />
                <span className="text-ink-muted">{formatDate(attempt.submittedAt, timezone)}</span>
                {attempt.rejectionStage && (
                  <span className="text-ink-muted">at {attempt.rejectionStage}</span>
                )}
              </li>
            ))}
          </ul>
        </CardSection>
      )}

      <TimelineStrip events={events} timezone={timezone} />

      {events.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="Nothing has happened yet"
          description="Events appear here as mail arrives, or when you move the card."
          action={{ label: 'Open the board', href: '/jobs/pipeline' }}
        />
      ) : (
        // One card of rows rather than a card per event: the tint on a row
        // that needs review is enough to single it out without its own border.
        <ol className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
          {events.map((event) => (
            <li
              key={event.id}
              className={cn(
                'card-pad-x row-pad flex gap-3',
                event.needsReview && 'bg-caution-tint',
              )}
            >
              {/* On a phone the date joins the grey line under the entry, so the
                  entry has the row's width (plan #1590's critic, law 9). */}
              <span className="tabular w-28 shrink-0 text-small text-ink-muted max-sm:hidden">
                {formatDate(event.occurredAt, timezone)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-ui text-ink">
                  {event.gmailHref ? (
                    <GmailLink href={event.gmailHref}>
                      {event.summary ?? event.kind.replace(/_/g, ' ')}
                    </GmailLink>
                  ) : (
                    (event.summary ?? event.kind.replace(/_/g, ' '))
                  )}
                </p>
                <p className="text-small text-ink-muted">
                  <span className="tabular sm:hidden">{formatDate(event.occurredAt, timezone)} · </span>
                  {event.kind.replace(/_/g, ' ')} · {event.source}
                </p>
                {event.needsReview && (
                  <p className="mt-1 flex items-start gap-1.5 text-small text-ink">
                    <CircleAlert
                      className="mt-0.5 size-3.5 shrink-0 text-caution"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    Recorded, but it did not change the status — that would have moved this
                    backwards.
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * The key events in a line, oldest on the left, each a dot in the colour of
 * the stage it moved the pursuit to (note 2cdbaaa5). Notes and status
 * overrides are left to the list below; the line is for the milestones.
 */
const KEY_EVENTS: Record<string, { label: string; dot: string }> = {
  submitted: { label: 'Applied', dot: 'bg-status-submitted' },
  confirmation: { label: 'Confirmed', dot: 'bg-status-submitted' },
  recruiter_reply: { label: 'Recruiter replied', dot: 'bg-status-process' },
  screen_scheduled: { label: 'Screen', dot: 'bg-status-process' },
  interview_scheduled: { label: 'Interview', dot: 'bg-status-process' },
  assessment_sent: { label: 'Assessment', dot: 'bg-status-process' },
  offer: { label: 'Offer', dot: 'bg-status-offer' },
  rejection: { label: 'Rejected', dot: 'bg-status-rejected' },
  withdrawal: { label: 'Withdrew', dot: 'bg-status-lead' },
};

/** A stop's date: day and month, and the year only when it is not this year's. */
function stopDate(iso: string, timezone: string): string {
  if (!Number.isFinite(new Date(iso).getTime())) return '—';
  return whenDate(iso, { timeZone: safeTimeZone(timezone) });
}

function TimelineStrip({
  events,
  timezone,
}: Pick<PanelProps, 'events' | 'timezone'>) {
  const key = events
    .filter((event) => event.kind in KEY_EVENTS)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  // Opens at the newest end, so how the pursuit stands is always in view and
  // the older stops are what a sideways scroll goes back to.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollLeft = node.scrollWidth;
  }, [key.length]);
  if (key.length === 0) return null;
  return (
    // Scrolls sideways when the stops outgrow a phone, rather than squeezing
    // their labels into each other.
    <div ref={scroller} className={cn(cardVariants(), 'card-pad-x row-pad overflow-x-auto')}>
      <ol className="flex min-w-max" aria-label="Key events, oldest first">
        {key.map((event, index) => {
          const shown = KEY_EVENTS[event.kind];
          return (
            <li key={event.id} className="relative flex w-20 shrink-0 flex-col items-center text-center">
              {/* The line runs from this dot to the next one. */}
              {index < key.length - 1 && (
                <span className="absolute left-1/2 top-1 h-0.5 w-full bg-border" aria-hidden />
              )}
              <span className={cn('relative size-2.5 rounded-full ring-2 ring-surface', shown.dot)} aria-hidden />
              <span className="mt-1.5 text-small text-ink">{shown.label}</span>
              <span className="tabular text-micro text-ink-muted">{stopDate(event.occurredAt, timezone)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

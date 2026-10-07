'use client';

import { CircleAlert, ListChecks } from 'lucide-react';
import { cn } from '@/lib/cn';
import { CardSection, cardVariants } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/jobs/ui/status-badge';
import { formatDate } from '@/lib/jobs/applications/load';
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
              <span className="tabular w-28 shrink-0 text-small text-ink-muted">
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

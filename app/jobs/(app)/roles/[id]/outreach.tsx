'use client';

import { Card } from '@/components/ui/card';
import { formatDate } from '@/lib/jobs/applications/load';
import { FollowUpCard } from '../../follow-ups/follow-up-card';
import type { PanelProps } from './types';

/**
 * The Outreach tab: the people to reach out to about this application, with
 * the note to each (the same card as the Follow-ups list), and below it what
 * has gone to anyone about it, the way the company page's Outreach tab lists
 * the sends to its people.
 */
export function Outreach({ followUp, sends = [], companyContacts, timezone }: PanelProps) {
  const answered = sends.filter((send) => send.respondedAt !== null);
  return (
    <div className="space-y-4">
      {followUp && <FollowUpCard initial={followUp} contacts={companyContacts} timezone={timezone} />}

      {sends.length > 0 && (
        <Card padding="dense" data-slot="section">
          <p className="tabular text-small text-ink-muted">
            {answered.length} of {sends.length} answered
          </p>
          <ul className="mt-2 divide-y divide-border">
            {sends.map((send) => (
              <li key={send.id} className="row-pad">
                <div className="flex flex-wrap items-baseline gap-2 text-ui">
                  <span className="font-medium text-ink">{send.contactName}</span>
                  <span className="text-ink-muted">{send.channel.replace(/_/g, ' ')}</span>
                  <span className="tabular text-small text-ink-muted">{formatDate(send.sentAt, timezone)}</span>
                  {send.respondedAt ? (
                    <span className="text-micro text-ink">replied</span>
                  ) : (
                    <span className="text-small text-ink-muted">no reply yet</span>
                  )}
                </div>
                {send.message && <p className="mt-0.5 line-clamp-2 text-small text-ink-muted">{send.message}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

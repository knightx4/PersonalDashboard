'use client';

import { useState } from 'react';
import { Select } from '@/components/ui/field';
import { useOptimisticWrite } from '@/lib/use-optimistic-write';
import { APPLICATION_SOURCES, SOURCE_LABELS, type ApplicationSource } from '@/lib/jobs/pipeline';
import { referrerLabel, type ReferrerOption } from '@/lib/jobs/contacts/referrers';
import { setChannel } from '@/app/jobs/(app)/pipeline/actions';

type Channel = { source: ApplicationSource; referralContactId: string | null };

/**
 * How you applied, changed where the role's facts are read.
 *
 * The inbox guesses the channel from the first email it finds for a pursuit,
 * and Insights compares channels, so a wrong guess skews every comparison
 * until somebody corrects it here. A referral also names who referred you.
 * It reads as text like the facts beside it, and opens its selects when
 * pressed.
 */
export function ChannelPicker({
  applicationId,
  source,
  referralContactId,
  contacts,
}: {
  applicationId: string;
  source: ApplicationSource;
  referralContactId: string | null;
  contacts: readonly ReferrerOption[];
}) {
  const { shown, run, pending, failed } = useOptimisticWrite<Channel, Channel>({
    value: { source, referralContactId },
    apply: (_current, next) => next,
    write: (next) => setChannel(applicationId, next.source, next.referralContactId),
  });

  const [editing, setEditing] = useState(false);
  const referrer = contacts.find((contact) => contact.id === shown.referralContactId);
  const label =
    shown.source === 'referral' && referrer
      ? `${SOURCE_LABELS.referral} · ${referrerLabel(referrer)}`
      : SOURCE_LABELS[shown.source];

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Change how you applied"
        className="press block max-w-full whitespace-normal rounded-control text-left text-ink underline decoration-border underline-offset-2 hover:decoration-ink max-sm:-my-3 max-sm:py-3"
      >
        {label}
      </button>
    );
  }

  return (
    <span className="flex flex-col items-start gap-1.5">
      <Select
        autoFocus
        value={shown.source}
        disabled={pending}
        aria-label="How you applied"
        aria-invalid={failed}
        onChange={(event) => {
          const next = event.target.value as ApplicationSource;
          run({ source: next, referralContactId: shown.referralContactId });
          // A referral still has a name to pick; anything else is settled.
          if (next !== 'referral') setEditing(false);
        }}
        className="h-8 w-full px-1.5 text-ui max-sm:min-h-11"
      >
        {APPLICATION_SOURCES.map((option) => (
          <option key={option} value={option}>
            {SOURCE_LABELS[option]}
          </option>
        ))}
      </Select>
      {shown.source === 'referral' && (
        <Select
          value={shown.referralContactId ?? ''}
          disabled={pending}
          aria-label="Who referred you"
          aria-invalid={failed}
          onChange={(event) => {
            run({ source: 'referral', referralContactId: event.target.value || null });
            setEditing(false);
          }}
          className="h-8 w-full px-1.5 text-ui max-sm:min-h-11"
        >
          <option value="">Who referred you?</option>
          {contacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {referrerLabel(contact)}
            </option>
          ))}
        </Select>
      )}
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="press rounded-control text-small text-ink-muted underline decoration-border underline-offset-2 hover:text-ink max-sm:min-h-11"
      >
        Done
      </button>
    </span>
  );
}

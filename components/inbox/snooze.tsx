'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { SectionFold } from '@/components/ui/disclosure';
import { cardVariants } from '@/components/ui/card';
import { StateLabel } from '@/components/dev/state-label';
import { LaterMenu } from '@/components/inbox/snooze-menu';
import { laterInboxRow, unsnoozeInboxRow } from '@/lib/core/inbox-snooze-actions';
import { cn } from '@/lib/cn';
import { deviceTimeZone, whenDate } from '@/lib/core/when';

/**
 * Later on one inbox row in Dev (plan #1843, #1957.2): the one Later menu,
 * whose days are read in the account's timezone on the server. `snoozeRef` is
 * the row's `schema.table:id` (lib/core/inbox-snoozes.ts). The row leaves the
 * list when the page refreshes after the press.
 */
export function SnoozeMenu({ snoozeRef, label }: { snoozeRef: string; label: string }) {
  const [error, setError] = useState<string | undefined>();
  const [, start] = useTransition();

  return (
    <span className="flex flex-wrap items-center gap-2">
      <LaterMenu
        label={label}
        onChoose={(choice) => {
          setError(undefined);
          start(async () => {
            const result = await laterInboxRow(snoozeRef, choice);
            if (result.error) setError(result.error);
          });
        }}
      />
      <FieldError>{error}</FieldError>
    </span>
  );
}

/** The small mark on a row that is back because its snooze ran out. */
export function BackFromSnoozeMark() {
  return (
    <StateLabel
      glyph="clock"
      word="Back from Later"
      tone="quiet"
      title="You put this off until today."
    />
  );
}

export type SnoozedItem = {
  ref: string;
  /** What the row is called, so the list says what is hidden. */
  title: string;
  /** When it comes back, as an ISO moment. */
  snoozedUntil: string;
};

/** "Fri 16 Oct", in the reader's own time zone. */
function dayLabel(iso: string): string {
  return whenDate(iso, { timeZone: deviceTimeZone() ?? 'UTC', weekday: 'short', year: 'never' });
}

function SnoozedRow({ item }: { item: SnoozedItem }) {
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="break-words text-body text-ink">{item.title}</p>
        <p className="text-small text-ink-muted">Back {dayLabel(item.snoozedUntil)}</p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        pending={pending}
        onClick={() =>
          start(async () => {
            const result = await unsnoozeInboxRow(item.ref);
            if (result.error) setError(result.error);
          })
        }
      >
        Bring back
      </Button>
      <FieldError>{error}</FieldError>
    </li>
  );
}

/**
 * What is snoozed, shut at the foot of an inbox, with an unsnooze on each row.
 * Draws nothing when nothing is snoozed.
 */
export function SnoozedList({ items }: { items: readonly SnoozedItem[] }) {
  if (items.length === 0) return null;
  return (
    <SectionFold title="Later" count={items.length} defaultOpen={false}>
      <ul className={cn(cardVariants(), 'divide-y divide-border')}>
        {items.map((item) => (
          <SnoozedRow key={item.ref} item={item} />
        ))}
      </ul>
    </SectionFold>
  );
}

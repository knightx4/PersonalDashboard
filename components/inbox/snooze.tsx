'use client';

import { useState, useTransition } from 'react';
import { FieldError } from '@/components/ui/field';
import { StateLabel } from '@/components/dev/state-label';
import { LaterMenu } from '@/components/inbox/snooze-menu';
import type { InboxLaterRow } from '@/components/inbox/inbox-page';
import { bringBackInboxRow, laterInboxRow } from '@/lib/core/inbox-snooze-actions';
import { deviceTimeZone, whenDate } from '@/lib/core/when';

/**
 * Later on one inbox row in Dev (plans #1843, #1937.4, #1957.2): the one
 * Later menu, whose days are read in the account's timezone on the server.
 * `snoozeRef` is the row's `schema.table:id` (lib/core/inbox-snoozes.ts).
 * The row leaves the list when the page refreshes after the press.
 */
export function SnoozeMenu({ snoozeRef, label = 'this row' }: { snoozeRef: string; label?: string }) {
  const [error, setError] = useState<string | undefined>();
  const [, start] = useTransition();

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
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

/** The small mark on a row that is back because the day it was put off to has come. */
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

/** What is snoozed, as rows for the Inbox page's Later fold, each with Bring back. */
export function snoozedLaterRows(items: readonly SnoozedItem[]): InboxLaterRow[] {
  return items.map((item) => ({
    ref: item.ref,
    title: item.title,
    line: `Back ${dayLabel(item.snoozedUntil)}`,
    bringBack: { action: bringBackInboxRow, fields: { ref: item.ref } },
  }));
}

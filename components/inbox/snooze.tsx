'use client';

import { useState, useTransition } from 'react';
import { FieldError } from '@/components/ui/field';
import { StateLabel } from '@/components/dev/state-label';
import { SnoozeMenu as LaterMenu } from '@/components/inbox/snooze-menu';
import type { InboxLaterRow } from '@/components/inbox/inbox-page';
import { bringBackInboxRow, snoozeInboxRow } from '@/lib/core/inbox-snooze-actions';
import { pickedDayStart } from '@/lib/core/inbox-snoozes';
import { snoozeDay } from '@/lib/core/snooze-days';

/** Today in the reader's own zone, as YYYY-MM-DD. */
function localToday(now: Date): string {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * Later on one Dev inbox row (plans #1843, #1937.4), with the menu every
 * Inbox has: Tomorrow, Next week or a day picked (lib/core/snooze-days.ts).
 * `snoozeRef` is the row's `schema.table:id` (lib/core/inbox-snoozes.ts).
 * The row leaves the list when the page refreshes after the press.
 */
export function SnoozeMenu({ snoozeRef, label = 'this row' }: { snoozeRef: string; label?: string }) {
  const [error, setError] = useState<string | undefined>();
  const [, start] = useTransition();

  function choose(choice: string) {
    const day = snoozeDay(choice, localToday(new Date()));
    const until = day ? pickedDayStart(day) : null;
    if (!until) {
      setError('Pick a day after today.');
      return;
    }
    setError(undefined);
    start(async () => {
      const result = await snoozeInboxRow(snoozeRef, until.toISOString());
      if (result.error) setError(result.error);
    });
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <LaterMenu label={label} onChoose={choose} />
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
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
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

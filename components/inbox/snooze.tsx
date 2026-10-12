'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { FieldError, Input } from '@/components/ui/field';
import { SectionFold } from '@/components/ui/disclosure';
import { cardVariants } from '@/components/ui/card';
import { StateLabel } from '@/components/dev/state-label';
import { snoozeInboxRow, unsnoozeInboxRow } from '@/lib/core/inbox-snooze-actions';
import { localDayStart, pickedDayStart, snoozeChoices } from '@/lib/core/inbox-snoozes';
import { cn } from '@/lib/cn';

/**
 * Snooze one inbox row, in Dev and in Goals (plan #1843). Closed to a single
 * ghost button; pressed, it offers tomorrow, next week or a day to pick.
 * `snoozeRef` is the row's `schema.table:id` (lib/core/inbox-snoozes.ts).
 * The row leaves the list when the page refreshes after the press.
 */
export function SnoozeMenu({ snoozeRef }: { snoozeRef: string }) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [day, setDay] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();

  function snooze(until: Date | null) {
    if (!until) {
      setError('Pick a day.');
      return;
    }
    setError(undefined);
    start(async () => {
      const result = await snoozeInboxRow(snoozeRef, until.toISOString());
      if (result.error) setError(result.error);
    });
  }

  if (!open) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Snooze
      </Button>
    );
  }

  const now = new Date();
  const { tomorrow, nextWeek } = snoozeChoices(now);
  const first = localDayStart(now, 1);
  const tomorrowIso = [
    first.getFullYear(),
    String(first.getMonth() + 1).padStart(2, '0'),
    String(first.getDate()).padStart(2, '0'),
  ].join('-');

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-small text-ink-muted">Snooze until</span>
      <Button type="button" size="sm" variant="secondary" pending={pending} onClick={() => snooze(tomorrow)}>
        Tomorrow
      </Button>
      <Button type="button" size="sm" variant="secondary" pending={pending} onClick={() => snooze(nextWeek)}>
        Next week
      </Button>
      {picking ? (
        <>
          <Input
            type="date"
            aria-label="Snooze until this day"
            value={day}
            min={tomorrowIso}
            onChange={(event) => setDay(event.target.value)}
            className="w-auto"
          />
          <Button
            type="button"
            size="sm"
            pending={pending}
            onClick={() => snooze(pickedDayStart(day))}
          >
            Snooze
          </Button>
        </>
      ) : (
        <Button type="button" size="sm" variant="secondary" onClick={() => setPicking(true)}>
          Pick a day
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          setOpen(false);
          setPicking(false);
          setError(undefined);
        }}
      >
        Cancel
      </Button>
      <FieldError>{error}</FieldError>
    </div>
  );
}

/** The small mark on a row that is back because its snooze ran out. */
export function BackFromSnoozeMark() {
  return (
    <StateLabel
      glyph="clock"
      word="Back from snooze"
      tone="quiet"
      title="You snoozed this, and the day has come."
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
        Unsnooze
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
    <SectionFold title="Snoozed" count={items.length} defaultOpen={false}>
      <ul className={cn(cardVariants(), 'divide-y divide-border')}>
        {items.map((item) => (
          <SnoozedRow key={item.ref} item={item} />
        ))}
      </ul>
    </SectionFold>
  );
}

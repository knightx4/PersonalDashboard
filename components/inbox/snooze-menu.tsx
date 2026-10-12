'use client';

import { useState } from 'react';
import { BellOff, ChevronDown } from 'lucide-react';
import { ActionMenu } from '@/components/ui/action-menu';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { SNOOZE_CHOICES, SNOOZE_LABELS } from '@/lib/core/snooze-days';

/**
 * The snooze control for an inbox row (plan #1844): Tomorrow, Next week, or a
 * day picked. It only asks; `onChoose` gets 'tomorrow', 'next_week' or a
 * YYYY-MM-DD day and does the write, so every inbox can use it.
 */
export function SnoozeMenu({
  label,
  onChoose,
}: {
  /** What the row is, for the control's accessible name. */
  label: string;
  onChoose: (choice: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [day, setDay] = useState('');

  if (picking) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          value={day}
          onChange={(event) => setDay(event.target.value)}
          aria-label={`Snooze until: ${label}`}
          className="w-auto max-sm:min-h-11"
        />
        <Button
          type="button"
          size="sm"
          disabled={!day}
          onClick={() => {
            onChoose(day);
            setPicking(false);
            setDay('');
          }}
        >
          Snooze
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setPicking(false)}>
          Cancel
        </Button>
      </span>
    );
  }

  return (
    <ActionMenu
      label={`Snooze: ${label}`}
      align="end"
      triggerClassName={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'w-auto')}
      trigger={
        <span className="inline-flex items-center gap-1">
          <BellOff className="size-3.5" strokeWidth={1.75} aria-hidden />
          <span className="max-sm:sr-only">Snooze</span>
          <ChevronDown className="size-3.5" strokeWidth={2} aria-hidden />
        </span>
      }
      items={[
        ...SNOOZE_CHOICES.map((choice) => ({
          id: choice,
          label: SNOOZE_LABELS[choice],
          onSelect: () => onChoose(choice),
        })),
        { id: 'pick', label: 'Pick a day', onSelect: () => setPicking(true) },
      ]}
    />
  );
}

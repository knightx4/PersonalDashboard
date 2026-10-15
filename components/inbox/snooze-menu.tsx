'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { LIFECYCLE_GLYPH, LIFECYCLE_VERB } from '@/lib/core/lifecycle';
import { PICK_A_DAY, SNOOZE_CHOICES, SNOOZE_LABELS } from '@/lib/core/snooze-days';

/**
 * Later, the one menu for putting a thing off (plan #1844, #1957.2): Tomorrow,
 * This weekend, Next week, Next month, or Pick a day, the same on a todo, a
 * goal step, a raise and an Inbox row. It only asks: `onChoose` gets one of
 * lib/core/snooze-days.ts's choices or a YYYY-MM-DD day and does the write,
 * which each caller records as it always has.
 */

const LATER = LIFECYCLE_VERB.later;

/**
 * The four named days as menu entries, for a menu that holds Later as one of
 * its steps (Todo's phone menu); Pick a day (PICK_A_DAY) is the fifth.
 */
export const LATER_CHOICES = SNOOZE_CHOICES.map((choice) => ({
  id: `later-${choice}`,
  label: SNOOZE_LABELS[choice],
  choice,
}));

function laterItems(onChoose: (choice: string) => void, onPick: () => void): ActionMenuItem[] {
  return [
    ...LATER_CHOICES.map(({ id, label, choice }) => ({ id, label, onSelect: () => onChoose(choice) })),
    { id: 'later-pick', label: PICK_A_DAY, onSelect: onPick },
  ];
}

/** Pick a day: a date field, with Later to put it off to that day and Cancel. */
export function LaterDayField({
  label,
  onChoose,
  onCancel,
}: {
  label: string;
  onChoose: (day: string) => void;
  onCancel: () => void;
}) {
  const [day, setDay] = useState('');
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Input
        type="date"
        value={day}
        onChange={(event) => setDay(event.target.value)}
        aria-label={`Later, until: ${label}`}
        className="w-auto max-sm:min-h-11"
      />
      <Button
        type="button"
        size="sm"
        disabled={!day}
        onClick={() => {
          onChoose(day);
          setDay('');
        }}
      >
        {LATER}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </span>
  );
}

export function LaterMenu({
  label,
  onChoose,
  compact = false,
}: {
  /** What the row is, for the control's accessible name. */
  label: string;
  onChoose: (choice: string) => void;
  /** The clock alone, for a row of icon controls; the word beside it otherwise. */
  compact?: boolean;
}) {
  const [picking, setPicking] = useState(false);

  if (picking) {
    return (
      <LaterDayField
        label={label}
        onChoose={(day) => {
          onChoose(day);
          setPicking(false);
        }}
        onCancel={() => setPicking(false)}
      />
    );
  }

  const menu = (
    <ActionMenu
      label={`${LATER}: ${label}`}
      align="end"
      triggerClassName={
        compact ? undefined : cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'w-auto')
      }
      trigger={
        compact ? (
          <StatusGlyph glyph={LIFECYCLE_GLYPH.later} size={16} />
        ) : (
          <span className="inline-flex items-center gap-1">
            <StatusGlyph glyph={LIFECYCLE_GLYPH.later} />
            <span className="max-sm:sr-only">{LATER}</span>
            <ChevronDown className="size-3.5" strokeWidth={1.75} aria-hidden />
          </span>
        )
      }
      items={laterItems(onChoose, () => setPicking(true))}
    />
  );

  return compact ? (
    <Tooltip label={LATER} align="end" className="flex">
      {menu}
    </Tooltip>
  ) : (
    menu
  );
}

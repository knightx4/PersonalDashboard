'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';
import { segmentedFrame } from '@/components/ui/segmented';
import { segmentClass, ToggleChip } from './proposed';

/**
 * The proposals that hold state, so they can be pressed on /preview/overhaul.
 * Split from proposed.tsx because a server page calls that file's class
 * functions, and a client module's functions cannot be called from the server.
 */

/** A row of ToggleChips that picks one, with local state for the drawing. */
export function ToggleChipRow({ options, initial }: { options: readonly string[]; initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <ToggleChip key={option} on={option === value} onClick={() => setValue(option)}>
          {option}
        </ToggleChip>
      ))}
    </div>
  );
}

export function SegmentedLinks({ options, initial }: { options: readonly string[]; initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <span
      role="group"
      className={cn(segmentedFrame, 'overflow-hidden')}
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-current={option === value ? 'true' : undefined}
          onClick={() => setValue(option)}
          className={segmentClass(option === value)}
        >
          {option}
        </button>
      ))}
    </span>
  );
}

/** A setting that takes effect at once, with no Save button after it. */
export function Switch({ label, hint, initial = false }: { label: string; hint?: string; initial?: boolean }) {
  const [on, setOn] = useState(initial);
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <span className="min-w-0">
        <span className="block text-ui text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-small text-ink-muted">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => setOn((value) => !value)}
        className={cn(
          'press press-area relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full',
          'transition-colors duration-quick focus-visible:outline-2 focus-visible:outline-offset-2',
          on ? 'bg-accent' : 'bg-border-strong',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'inline-block size-4 rounded-full bg-surface transition-transform duration-quick',
            on ? 'translate-x-4.5' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}

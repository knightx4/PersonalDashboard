'use client';

import { useState } from 'react';
import { ToggleChip } from '@/components/ui/chip';
import { segmentClass, segmentedFrame } from '@/components/ui/segmented';

/**
 * The shared components that hold state, wrapped with local state so they
 * can be pressed on /preview/overhaul.
 */

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
    <span role="group" className={segmentedFrame}>
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

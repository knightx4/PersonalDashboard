'use client';

import { Lightbulb } from 'lucide-react';
import { ToggleChip } from '@/components/ui/chip';
import { Tooltip } from '@/components/ui/tooltip';
import { approxDollars } from '@/lib/core/spend/estimate-types';
import { turnThought } from '@/lib/talk/thought';
import type { TalkToolCall } from '@/lib/talk/talk';

/**
 * "Think it through" on Dash's box (plan #2789.10): pressed, the next
 * questions are answered on Opus at high effort, with web search, the specs,
 * the code and a mockup (lib/dash/think.ts). Off, it is the bulb alone, since
 * the foot already holds the file, scope and model chips; on, it says its name
 * in the model chip's place, since the model is then Opus whatever was
 * picked. It stays on until it is pressed again.
 */
export function ThinkSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <Tooltip
      label={
        on
          ? 'Dash thinks each answer through on Opus, with the web and the code. Slower, and costs more.'
          : 'Think it through: a slower, deeper answer on Opus, with the web and the code.'
      }
      className="shrink-0"
    >
      <ToggleChip
        on={on}
        aria-label="Think it through"
        onClick={() => onChange(!on)}
        className={on ? 'h-5.5 px-2' : 'h-5.5 w-7 justify-center px-0'}
      >
        <Lightbulb strokeWidth={1.75} aria-hidden />
        {on && <span>Think it through</span>}
      </ToggleChip>
    </Tooltip>
  );
}

/** "Thought through on Opus · About $0.42", under an answer that was; nothing under one that was not. */
export function ThoughtLine({ calls }: { calls: readonly TalkToolCall[] | undefined }) {
  const thought = turnThought(calls);
  if (!thought) return null;
  const cost =
    thought.costMicros === null
      ? 'cost not recorded'
      : thought.costMicros < 10_000
        ? 'under a cent'
        : `about ${approxDollars(thought.costMicros)}`;
  return (
    <p className="mt-2 flex items-center gap-1.5 text-small text-ink-muted">
      <Lightbulb className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
      <span>
        Thought through on Opus · <span className="tabular">{cost}</span>
      </span>
    </p>
  );
}

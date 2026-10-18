'use client';

import Link from '@/components/ui/link';
import { DashMark, type DashRunner } from '@/components/ui/dash-mark';
import { Tooltip } from '@/components/ui/tooltip';
import { useNewestRunLines } from '@/components/runs/use-newest-run-lines';
import { useRunPose } from '@/components/runs/use-run-pose';
import { useRunnerSlots } from '@/components/runs/use-runner-slots';
import type { RunActivity } from '@/lib/core/run-activities';
import { SLOT_NOTHING_READY, type RunnerSlot, type SlotId } from '@/lib/plan/overnight-slots';

/** Each slot's Dash, the same as the runner card's (app/dev/plan/runner-crew.tsx). */
const RUNNERS: Record<SlotId, DashRunner> = {
  'feature-1': 'feature-1',
  'feature-2': 'feature-2',
  'feature-3': 'feature-3',
  'feature-4': 'goals',
  goals: 'goals',
};

/** What a slot is doing, in the few words a tip has room for. */
function said(slot: RunnerSlot): string {
  if (slot.state === 'working') {
    const { ref, title } = slot.work;
    return `${slot.label}: ${[ref, title].filter(Boolean).join(' ') || 'working'}`;
  }
  if (slot.state === 'asleep') {
    return `${slot.label}: ${slot.line === SLOT_NOTHING_READY ? 'nothing ready' : 'free'}`;
  }
  return `${slot.label}: not running`;
}

function SlotDash({ slot, newest }: { slot: RunnerSlot; newest: RunActivity | null }) {
  const working = slot.state === 'working';
  // While it works, the Dash takes the shape of its newest line, as on the card.
  const { pose, moment } = useRunPose(working ? newest : null);
  const label = said(slot);
  return (
    <Tooltip label={label} above>
      <Link
        href="/dev/plan"
        aria-label={label}
        className="flex items-center rounded-full p-0.5 transition-colors hover:bg-shell-hover"
      >
        <DashMark
          // A slot not at work sleeps, whether the runner has nothing for it
          // or is not running at all.
          state={working ? pose.state : 'asleep'}
          activity={working ? pose.activity : undefined}
          moment={working ? (moment ?? undefined) : undefined}
          runner={RUNNERS[slot.slot]}
          size="sm"
          decorative
          still={!working}
        />
      </Link>
    </Tooltip>
  );
}

/**
 * The runner's four Dashes on the status line, just before the CI dot: the
 * same four as the runner card on /dev/plan, each in its own visor and colour,
 * working in the shape of its run's newest line while its slot works and asleep
 * otherwise. Each links to the plan, where the card says the rest.
 *
 * Only the owner has a runner, so nobody else asks for the slots or sees any.
 */
export function RunnerDashes({ owner }: { owner: boolean }) {
  const slots = useRunnerSlots(owner);
  const runIds = slots.flatMap((slot) =>
    slot.state === 'working' && slot.work.runId ? [slot.work.runId] : [],
  );
  const newest = useNewestRunLines(runIds);
  if (slots.length === 0) return null;

  return (
    <span
      role="group"
      aria-label="The runner's sessions"
      data-runner-dashes=""
      // 24px Dashes, pulled into the line's padding so the line keeps its height.
      className="pointer-events-auto -my-1 flex shrink-0 items-center gap-1"
    >
      {slots.map((slot) => (
        <SlotDash
          key={slot.slot}
          slot={slot}
          newest={
            slot.state === 'working' && slot.work.runId
              ? (newest.get(slot.work.runId) ?? null)
              : null
          }
        />
      ))}
    </span>
  );
}

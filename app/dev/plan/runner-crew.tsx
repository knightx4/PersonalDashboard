import { DashMark, type DashLook } from '@/components/ui/dash-mark';
import type { FeatureProgress } from '@/lib/digest/night';
import { Disclosure } from '@/components/ui/disclosure';
import { Meter } from '@/components/ui/meter';
import { SectionLabel } from '@/components/ui/section-heading';
import { SLOT_ASLEEP_DEFAULT, type RunnerSlot, type SlotId } from '@/lib/plan/overnight-slots';

/**
 * The runner's four Dashes, one for each thing it can run at once (plan
 * #1704): three feature sessions and the goals seat, which a fourth feature
 * takes while goals has nothing to start. They stack in one column. Each wears
 * its own hat, so the eye can follow one from glance to glance, and shows one
 * of three states with what goes with it to its right.
 *
 *   idle     the runner is off or held. "Not running", or "Held".
 *   working  a session is going in that slot: the feature it is on, the
 *            workspace and how long, and a meter of the feature's steps done.
 *   asleep   the runner is on and the slot has nothing ready: the tick's
 *            reason.
 *
 * Which session takes which slot is `runnerSlots`' call; this only draws it.
 */

/** Decision #1701: the hats, in slot order. */
const LOOKS: Record<SlotId, DashLook> = {
  'feature-1': 'top-hat',
  'feature-2': 'ball-cap',
  'feature-3': 'cowboy-hat',
  // The fourth feature sits in the goals seat, so it wears the goals hat.
  'feature-4': 'newsboy-cap',
  goals: 'newsboy-cap',
};

function SlotText({
  slot,
  held,
  progress,
}: {
  slot: RunnerSlot;
  held: boolean;
  progress: FeatureProgress | null;
}) {
  if (slot.state === 'working') {
    const { work } = slot;
    const meta = [
      // The Goals Dash's heading already says the workspace.
      slot.slot === 'goals' ? null : work.module,
      work.doing,
      progress ? `${progress.done} of ${progress.total} steps done` : null,
      work.elapsed,
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <>
        <span className="sr-only">Working on </span>
        <span className="block min-w-0 truncate text-ui text-ink">
          {work.ref && <span className="tabular font-medium">{work.ref} </span>}
          {work.title ?? 'a run with no step recorded'}
        </span>
        {meta && <span className="block truncate text-small text-ink-muted">{meta}</span>}
        {progress && (
          <Meter
            value={progress.done}
            max={progress.total}
            label={`${work.ref ?? 'The feature'}: ${progress.done} of ${progress.total} steps done`}
            minFraction={0.04}
            moves
            className="mt-1.5 max-w-sm"
          />
        )}
      </>
    );
  }
  if (slot.state === 'asleep') {
    const line = 'Asleep, nothing to work on';
    // The default reason says nothing the line has not, so there is nothing to open.
    if (slot.reason === SLOT_ASLEEP_DEFAULT) {
      return <span className="block text-ui text-ink-muted">{line}</span>;
    }
    // The tick's reason can run to several lines (skipped features, the retry
    // hint), so it stays folded until asked for. The fold is a native
    // disclosure: keyboard reachable, and it opens before scripts load.
    return (
      <Disclosure
        className="min-w-0"
        title={<span className="font-normal text-ink-muted">{line}</span>}
        bodyClassName="mt-1 ml-5.5"
      >
        <span className="block text-small text-ink-muted">{slot.reason}</span>
      </Disclosure>
    );
  }
  return <span className="block text-ui text-ink-muted">{held ? 'Held' : 'Not running'}</span>;
}

export function RunnerCrew({
  slots,
  held = false,
  progress = {},
}: {
  slots: readonly RunnerSlot[];
  /** How far through its feature each session is, by the feature's "#n". */
  progress?: Readonly<Record<string, FeatureProgress>>;
  /** The runner is held: an idle slot says so rather than "Not running". */
  held?: boolean;
}) {
  return (
    <ul aria-label="What each of the runner's four sessions is doing" className="flex flex-col gap-3">
      {slots.map((slot) => (
        <li key={slot.slot} className="flex min-w-0 items-start gap-3">
          <DashMark
            state={slot.state}
            look={LOOKS[slot.slot]}
            tone={slot.state === 'working' ? 'brand' : 'current'}
            size="md"
            decorative
            className={slot.state === 'working' ? undefined : 'text-ink-muted'}
          />
          <span className="min-w-0 flex-1">
            <SectionLabel as="span" className="block">
              {slot.label}
            </SectionLabel>
            <SlotText
              slot={slot}
              held={held}
              progress={
                slot.state === 'working' && slot.work.step !== null
                  ? (slot.work.progress ?? progress[`#${slot.work.step}`] ?? null)
                  : null
              }
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

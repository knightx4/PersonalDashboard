'use client';

import { useState } from 'react';
import { DashMark, type DashRunner } from '@/components/ui/dash-mark';
import type { FeatureProgress } from '@/lib/digest/night';
import { Meter } from '@/components/ui/meter';
import { Tooltip } from '@/components/ui/tooltip';
import {
  SLOT_ASLEEP_DEFAULT,
  SLOT_NOTHING_READY,
  type RunnerSlot,
  type SlotId,
} from '@/lib/plan/overnight-slots';
import { useNewestRunLines } from '@/components/runs/use-newest-run-lines';
import { useRunPose } from '@/components/runs/use-run-pose';
import { LiveRunLines } from '@/components/runs/live-run-lines';
import { type RunActivity } from '@/lib/core/run-activities';
import { answerPlanRunAction } from './run-actions';

/**
 * The runner's four Dashes, one for each thing it can run at once (plan
 * #1704): three feature sessions and the goals seat, which a fourth feature
 * takes while goals has nothing to start.
 *
 * They sit in a strip, one pill each. A pill shows its own Dash, with its own
 * visor shape and colour, so the eye can follow one from glance to glance, and
 * says what the slot is doing: the workspace and feature with its meter while
 * it works, the tick's reason while it sleeps, "Held" or "Not running" while
 * the runner is held or off. While a slot works, its Dash takes the shape of
 * the run's newest line: reading, searching, testing, writing or thinking,
 * asking while a question waits on you, with a wince for an error and a hop
 * for a step finished (lib/core/run-pose.ts).
 *
 * Pressing a pill opens the slot below the strip: the whole of what its run
 * has written, live, with any question it is waiting on to answer there.
 * Pressing it again closes it. Nothing is open to begin with, so the card is
 * the strip until you ask for more.
 *
 * Which session takes which slot is `runnerSlots`' call; this only draws it.
 */

/** Each slot's Dash: its own visor shape and colour, in slot order. */
const RUNNERS: Record<SlotId, DashRunner> = {
  'feature-1': 'feature-1',
  'feature-2': 'feature-2',
  'feature-3': 'feature-3',
  // The fourth feature sits in the goals seat, so it takes the goals Dash.
  'feature-4': 'goals',
  goals: 'goals',
};

/**
 * The pill's second line, in a word or two. The full reason, and the run's
 * lines, are in the panel the pill opens: four quarter-width pills cut any
 * sentence off, so a pill says only what fits.
 */
function pillStatus(slot: RunnerSlot, held: boolean, progress: FeatureProgress | null): string {
  if (slot.state === 'working') {
    return [slot.work.elapsed, progress ? `${progress.done} of ${progress.total} steps` : null]
      .filter(Boolean)
      .join(' · ');
  }
  if (slot.state === 'asleep') return slot.line === SLOT_NOTHING_READY ? 'Nothing ready' : 'Free';
  return held ? 'Held' : 'Not running';
}

/** The pill's first line: the workspace and the feature's number, or the seat's name. */
function PillName({ slot }: { slot: RunnerSlot }) {
  if (slot.state !== 'working') return <>{slot.slot === 'goals' ? 'Goals' : slot.label}</>;
  const { work } = slot;
  const name = slot.slot === 'goals' ? 'Goals' : (work.module ?? 'App');
  const title = work.title ?? 'A run with no step recorded';
  return (
    <>
      <span className="sr-only">Working on </span>
      {name}{' '}
      {/* The title is long and the pill is a quarter of the card, so it
          waits in a tip on the number, and in the panel the pill opens. */}
      <Tooltip label={title}>
        <span className="tabular font-medium">{work.ref ?? title}</span>
      </Tooltip>
      <span className="sr-only">, {title}</span>
    </>
  );
}

function Pill({
  slot,
  held,
  newest,
  progress,
  open,
  panel,
  onPress,
}: {
  slot: RunnerSlot;
  held: boolean;
  newest: RunActivity | null;
  progress: FeatureProgress | null;
  open: boolean;
  panel: string;
  onPress: () => void;
}) {
  const working = slot.state === 'working';
  // While it works, the Dash takes the shape of its newest line (lib/core/run-pose.ts).
  const { pose, moment } = useRunPose(working ? newest : null);
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={panel}
      onClick={onPress}
      className={`flex w-full min-w-0 items-center gap-3 rounded-control border px-3 py-2.5 text-left transition-colors ${
        open ? 'border-accent bg-accent-tint' : 'border-border bg-sunken hover:border-border-strong'
      }`}
    >
      <DashMark
        state={working ? pose.state : slot.state}
        activity={working ? pose.activity : undefined}
        moment={working ? (moment ?? undefined) : undefined}
        runner={RUNNERS[slot.slot]}
        size="md"
        decorative
      />
      {/* Every pill has the same three rows, a meter track included, so the
          four stand the same height whatever their slots are doing. */}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={`block truncate text-ui ${working ? 'text-ink' : 'text-ink-muted'}`}>
          <span className="sr-only">{slot.label}: </span>
          <PillName slot={slot} />
        </span>
        <span className="block truncate text-small text-ink-muted tabular">
          {pillStatus(slot, held, progress)}
        </span>
        {progress ? (
          <Meter
            value={progress.done}
            max={progress.total}
            label={`${working ? (slot.work.ref ?? 'The feature') : slot.label}: ${progress.done} of ${progress.total} steps done`}
            minFraction={0.04}
            moves
          />
        ) : (
          <span aria-hidden className="block h-1.5 rounded-full bg-canvas" />
        )}
      </span>
    </button>
  );
}

/** The open slot: what its run is on and everything it has written. */
function Focus({
  id,
  slot,
  held,
  progress,
  newest,
}: {
  id: string;
  slot: RunnerSlot;
  held: boolean;
  progress: FeatureProgress | null;
  newest: RunActivity | null;
}) {
  if (slot.state !== 'working') {
    const said =
      slot.state === 'asleep'
        ? slot.reason === SLOT_ASLEEP_DEFAULT
          ? slot.line
          : slot.reason
        : held
          ? 'The runner is held: what was building carries on, and nothing new starts.'
          : 'The runner is off.';
    return (
      <div id={id} className="rounded-control bg-sunken px-4 py-3 text-ui text-ink-muted">
        {said}
      </div>
    );
  }
  const { work } = slot;
  const meta = [
    slot.slot === 'goals' ? null : work.module,
    work.doing,
    progress ? `${progress.done} of ${progress.total} steps done` : null,
    work.elapsed,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div id={id} className="flex min-w-0 flex-col gap-2">
      <div className="min-w-0">
        <span className="block text-ui text-ink">
          {work.ref && <span className="tabular font-medium">{work.ref} </span>}
          {work.title ?? 'A run with no step recorded'}
        </span>
        {meta && <span className="block text-small text-ink-muted">{meta}</span>}
      </div>
      {work.runId ? (
        <LiveRunLines
          runTable="plan_runs"
          runId={work.runId}
          // A question as the newest line is a run waiting on you, so its
          // options show here to answer.
          state={newest?.kind === 'question' ? 'waiting' : 'live'}
          answer={answerPlanRunAction}
        />
      ) : (
        <p className="text-small text-ink-muted">This run left no record to follow.</p>
      )}
    </div>
  );
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
  const [open, setOpen] = useState<SlotId | null>(null);
  const runIds = slots.flatMap((slot) =>
    slot.state === 'working' && slot.work.runId ? [slot.work.runId] : [],
  );
  const newest = useNewestRunLines(runIds);
  const newestOf = (slot: RunnerSlot) =>
    slot.state === 'working' && slot.work.runId ? (newest.get(slot.work.runId) ?? null) : null;
  const progressOf = (slot: RunnerSlot) =>
    slot.state === 'working' && slot.work.step !== null
      ? (slot.work.progress ?? progress[`#${slot.work.step}`] ?? null)
      : null;
  const panel = 'runner-crew-focus';
  // A slot that went away (the fourth feature ended) closes with it.
  const focused = slots.find((slot) => slot.slot === open) ?? null;

  return (
    <div className="flex flex-col gap-3">
      <ul
        aria-label="What each of the runner's four sessions is doing"
        className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4"
      >
        {slots.map((slot) => (
          <li key={slot.slot} className="min-w-0">
            <Pill
              slot={slot}
              held={held}
              newest={newestOf(slot)}
              progress={progressOf(slot)}
              open={open === slot.slot}
              panel={panel}
              onPress={() => setOpen((was) => (was === slot.slot ? null : slot.slot))}
            />
          </li>
        ))}
      </ul>
      {focused && (
        <Focus
          id={panel}
          slot={focused}
          held={held}
          progress={progressOf(focused)}
          newest={newestOf(focused)}
        />
      )}
    </div>
  );
}

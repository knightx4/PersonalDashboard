'use client';

import { useState } from 'react';
import { DashMark, type DashLook } from '@/components/ui/dash-mark';
import type { FeatureProgress } from '@/lib/digest/night';
import { Meter } from '@/components/ui/meter';
import { SectionLabel } from '@/components/ui/section-heading';
import { SLOT_ASLEEP_DEFAULT, type RunnerSlot, type SlotId } from '@/lib/plan/overnight-slots';
import { useNewestRunLines } from '@/components/runs/use-newest-run-lines';
import { LiveRunLines } from '@/components/runs/live-run-lines';
import { RUN_ACTIVITY_LABEL, type RunActivity } from '@/lib/core/run-activities';
import { answerPlanRunAction } from './run-actions';

/**
 * The runner's four Dashes, one for each thing it can run at once (plan
 * #1704): three feature sessions and the goals seat, which a fourth feature
 * takes while goals has nothing to start.
 *
 * They sit in a strip, one pill each. A pill wears its Dash's hat, so the eye
 * can follow one from glance to glance, and says in one line what the slot is
 * doing: the feature and its meter with the run's newest line while it
 * works, the tick's reason while it sleeps, "Held" or "Not running" while the
 * runner is held or off.
 *
 * Pressing a pill opens the slot below the strip: the whole of what its run
 * has written, live, with any question it is waiting on to answer there.
 * Pressing it again closes it. Nothing is open to begin with, so the card is
 * the strip until you ask for more.
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

/** What the slot's pill says under its heading. */
function pillLine(slot: RunnerSlot, held: boolean, newest: RunActivity | null): string {
  if (slot.state === 'working') {
    return newest ? `${RUN_ACTIVITY_LABEL[newest.kind]}: ${newest.body}` : '';
  }
  if (slot.state === 'asleep') return slot.line;
  return held ? 'Held' : 'Not running';
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
  const line = pillLine(slot, held, newest);
  const meta = working
    ? [slot.slot === 'goals' ? null : slot.work.module, slot.work.doing, slot.work.elapsed]
        .filter(Boolean)
        .join(' · ')
    : '';
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={panel}
      onClick={onPress}
      className={`flex min-h-11 min-w-0 items-start gap-2.5 rounded-control border px-3 py-2.5 text-left transition-colors ${
        open ? 'border-accent bg-accent-soft' : 'border-border bg-sunken hover:border-border-strong'
      }`}
    >
      <DashMark
        state={slot.state}
        look={LOOKS[slot.slot]}
        tone={working ? 'brand' : 'current'}
        size="md"
        decorative
        className={working ? undefined : 'text-ink-muted'}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <SectionLabel as="span" className="block truncate">
          {slot.label}
        </SectionLabel>
        {working && (
          <span className="block truncate text-ui text-ink">
            <span className="sr-only">Working on </span>
            {slot.work.ref && <span className="tabular font-medium">{slot.work.ref} </span>}
            {slot.work.title ?? 'a run with no step recorded'}
          </span>
        )}
        {meta && <span className="block truncate text-small text-ink-muted">{meta}</span>}
        {progress && (
          <Meter
            value={progress.done}
            max={progress.total}
            label={`${working ? (slot.work.ref ?? 'The feature') : slot.label}: ${progress.done} of ${progress.total} steps done`}
            minFraction={0.04}
            moves
          />
        )}
        {line && (
          <span
            // Keyed by the line, so a new one replaces the old rather than
            // the text changing under the reader.
            key={newest?.id}
            className={`block truncate text-small ${
              newest?.kind === 'error' ? 'text-danger' : working ? 'text-ink' : 'text-ink-muted'
            }`}
          >
            {line}
          </span>
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

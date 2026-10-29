'use client';

import { useState } from 'react';
import { DashMark, type DashRunner } from '@/components/ui/dash-mark';
import { cn } from '@/lib/cn';
import type { FeatureProgress, FeatureStep } from '@/lib/digest/night';
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
import { MODULES, type ModuleId } from '@/lib/modules';
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
 * The pill's second line while it sleeps or is off, in a word or two. The full
 * reason is in the panel the pill opens: four quarter-width pills cut any
 * sentence off, so a pill says only what fits.
 */
function idleStatus(slot: RunnerSlot, held: boolean): string {
  if (slot.state === 'asleep') return slot.line === SLOT_NOTHING_READY ? 'Nothing ready' : 'Free';
  return held ? 'Held' : 'Not running';
}

/** The steps a builder is on now, in plan order. Several go at once when they touch different files. */
function stepsOn(steps: readonly FeatureStep[]): FeatureStep[] {
  return steps.filter((step) => step.status === 'in_progress');
}

/**
 * The pill's second line while it works: the step being built, by its number
 * under the feature and its title, so the pill says what is happening and not
 * only how far along. Before the session claims a step it says how many are
 * done; a goals run says what it is doing.
 */
function WorkingLine({
  slot,
  progress,
}: {
  slot: RunnerSlot & { state: 'working' };
  progress: FeatureProgress | null;
}) {
  const { work } = slot;
  const on = stepsOn(work.steps);
  const feature = work.ref ?? '';
  let said: React.ReactNode;
  if (on.length > 0) {
    const first = on[0];
    said = (
      <>
        <span className="sr-only">On step </span>
        <span className="tabular text-ink-ghost">
          {first.ref.startsWith(feature) ? first.ref.slice(feature.length) : first.ref}
        </span>{' '}
        <span>{first.title}</span>
        {on.length > 1 && <span className="tabular text-ink-ghost"> +{on.length - 1}</span>}
      </>
    );
  } else if (progress) {
    said = `${progress.done} of ${progress.total} steps done`;
  } else {
    said = work.doing ?? work.ref ?? '';
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-small text-ink-muted">
      <ModuleCapsule name={slot.slot === 'goals' ? 'Goals' : (work.module ?? 'App')} />
      <span className="min-w-0 flex-1 truncate">{said}</span>
      {work.elapsed && <span className="tabular shrink-0 text-ink-ghost">{work.elapsed}</span>}
    </span>
  );
}

/** Where a step stands, as its segment in the pill's bar. */
const SEGMENT: Record<FeatureStep['status'], string> = {
  done: 'bg-accent',
  in_progress: 'bg-accent/45 motion-safe:animate-pulse',
  blocked: 'bg-caution',
  not_started: 'bg-canvas',
  proposed: 'bg-canvas',
  dropped: 'bg-canvas',
};

/** More steps than this and the segments are too thin to tell apart, so the bar is a meter. */
const MOST_SEGMENTS = 16;

/**
 * The bar under a working pill: one segment for each step of the feature,
 * filled when done and pulsing while a builder is on it, so "two done, one
 * going, one to go" is read without a number.
 */
function StepBar({
  slot,
  progress,
}: {
  slot: RunnerSlot & { state: 'working' };
  progress: FeatureProgress | null;
}) {
  const { steps, ref } = slot.work;
  const done = steps.filter((step) => step.status === 'done').length;
  if (steps.length > 0 && steps.length <= MOST_SEGMENTS) {
    return (
      <span
        role="img"
        aria-label={`${ref ?? 'The feature'}: ${done} of ${steps.length} steps done`}
        className="flex h-1.5 gap-0.5"
      >
        {steps.map((step) => (
          <span key={step.ref} className={`min-w-0 flex-1 rounded-full ${SEGMENT[step.status]}`} />
        ))}
      </span>
    );
  }
  if (progress) {
    return (
      <Meter
        value={progress.done}
        max={progress.total}
        label={`${ref ?? 'The feature'}: ${progress.done} of ${progress.total} steps done`}
        minFraction={0.04}
        moves
      />
    );
  }
  return <span aria-hidden className="block h-1.5 rounded-full bg-canvas" />;
}

/**
 * Literal class names, because Tailwind finds classes by reading source. A
 * template built from the module id would compile to nothing.
 */
const CAPSULE_HUES: Record<ModuleId, string> = {
  shopping: 'bg-w-shopping-tint text-w-shopping',
  jobs: 'bg-w-jobs-tint text-w-jobs',
  todo: 'bg-w-todo-tint text-w-todo',
  vault: 'bg-w-vault-tint text-w-vault',
  learn: 'bg-w-learn-tint text-w-learn',
  news: 'bg-w-news-tint text-w-news',
  goals: 'bg-w-goals-tint text-w-goals',
  you: 'bg-w-you-tint text-w-you',
  finances: 'bg-w-finances-tint text-w-finances',
  dev: 'bg-w-dev-tint text-w-dev',
};

/**
 * The workspace a slot works in, as a capsule in that workspace's colour, so
 * it reads apart from the step number beside it (note 7c8b9707). The slot
 * carries the workspace's label; a project or the app as a whole has no hue
 * and takes a plain one.
 */
function ModuleCapsule({ name }: { name: string }) {
  const workspace = MODULES.find((m) => m.label === name || m.id === name.toLowerCase());
  const hue = workspace ? CAPSULE_HUES[workspace.id] : 'bg-canvas text-ink-muted';
  return (
    <span className={`inline-block shrink-0 rounded-full px-1.5 text-micro font-medium ${hue}`}>
      {name}
    </span>
  );
}

/**
 * The pill's first line: the feature's name, or the seat's name. The name,
 * not the number, because "#2124" says nothing at a glance; the number is in
 * the tip and in the panel the pill opens. It has the row to itself, with the
 * workspace on the line under it, so as much of the name shows as fits.
 */
function PillName({ slot }: { slot: RunnerSlot }) {
  if (slot.state !== 'working') return <>{slot.slot === 'goals' ? 'Goals' : slot.label}</>;
  const { work } = slot;
  const title = work.title ?? 'A run with no step recorded';
  const tip = work.ref ? `${work.ref} ${title}` : title;
  return (
    <>
      <span className="sr-only">Working on </span>
      {/* Cut at the edge; the whole of it waits in a tip, and in the panel
          the pill opens. */}
      <Tooltip label={tip} className="block min-w-0">
        <span className="block min-w-0 truncate font-medium">{title}</span>
      </Tooltip>
      {work.ref && <span className="sr-only">, {work.ref}</span>}
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
  plain,
}: {
  slot: RunnerSlot;
  plain: boolean;
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
      className={cn(
        'flex w-full min-w-0 items-center gap-2.5 rounded-control border px-3 py-2.5 text-left transition-colors' /* ui-ok: a pressable pill whose border shows it open, as it was before plan #2457.7 moved it into cn */,
        open
          ? 'border-accent bg-accent-tint'
          : 'border-border bg-sunken hover:border-border-strong',
        // Plain, inside a card on a phone, the pill is a row rather than a box
        // in the box (plan #2457.7).
        plain && 'max-sm:border-transparent max-sm:bg-transparent max-sm:px-0 max-sm:py-1.5',
      )}
    >
      <DashMark
        state={working ? pose.state : slot.state}
        activity={working ? pose.activity : undefined}
        moment={working ? (moment ?? undefined) : undefined}
        runner={RUNNERS[slot.slot]}
        // 44px, as tall as the pill's three rows, so the Dash is larger
        // without the pill growing.
        size="lg"
        decorative
        // Only a slot at work glows; asleep or off, its Dash sits unlit.
        still={!working}
      />
      {/* Every pill has the same three rows, a bar included, so the four
          stand the same height side by side whatever their slots are doing:
          the feature, the step being built with the clock, and a segment for
          each step. */}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={`block min-w-0 text-ui ${working ? 'text-ink' : 'text-ink-muted'}`}>
          <span className="sr-only">{slot.label}: </span>
          <PillName slot={slot} />
        </span>
        {working ? (
          <WorkingLine slot={slot} progress={progress} />
        ) : (
          <span className="block truncate text-small text-ink-muted">{idleStatus(slot, held)}</span>
        )}
        {working ? (
          <StepBar slot={slot} progress={progress} />
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
  plain,
}: {
  id: string;
  slot: RunnerSlot;
  held: boolean;
  progress: FeatureProgress | null;
  newest: RunActivity | null;
  plain: boolean;
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
      <div
        id={id}
        className={cn(
          'rounded-control bg-sunken px-4 py-3 text-ui text-ink-muted',
          plain && 'max-sm:bg-transparent max-sm:p-0',
        )}
      >
        {said}
      </div>
    );
  }
  const { work } = slot;
  const meta = [
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
          <ModuleCapsule name={slot.slot === 'goals' ? 'Goals' : (work.module ?? 'App')} />
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
          // A feature session's lines fold under the feature's steps, and
          // what it wrote about other features is left out.
          feature={
            work.ref && work.steps.length > 0 ? { ref: work.ref, steps: work.steps } : undefined
          }
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
  plain = false,
}: {
  slots: readonly RunnerSlot[];
  /** Inside a card, as on dev settings: on a phone the pills drop their boxes. */
  plain?: boolean;
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
        // The four slots sit side by side, as the person asked: four across
        // from laptop width, two by two on a tablet, one column only where a
        // phone has no room. Do not redraw them as stacked rows; a design
        // check did that once (#2074) and it undid the person's layout.
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
              plain={plain}
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
          plain={plain}
        />
      )}
    </div>
  );
}

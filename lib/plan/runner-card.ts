/**
 * Everything the runner's card says, read once for both pages that draw it.
 *
 * The plan page and Dash both draw `OvernightControl`, and each used to build
 * its props its own way: the plan page named every session running but gave no
 * progress through a feature, Dash gave progress but named only the night's
 * last fire, and the plan page dropped a night from the card the moment it
 * stopped. So the same runner read differently depending on which page was
 * open. Both pages now hand the same rows to this and pass what comes back.
 *
 * Pure: the pages load the rows, this only reads them.
 */
import {
  featureProgress,
  lastNightFrom,
  onNow,
  type DigestNight,
  type DigestNightRef,
  type FeatureProgress,
  type NightFire,
  type OnNow,
} from '@/lib/digest/night';
import { oneLine } from '@/lib/digest/build';
import type { PlanItem } from './load';
import { lastStoredPush, type StoredPush } from './liveness';
import { runEnd, type StoredRunReading } from './run-end';
import { overnightStanding, type OvernightRun } from './overnight';
import { readyFeatureCount } from './overnight-choice';
import { topFeatureOf, workOrder, type PlanSection } from './tree';

/** A row a session is on, with how far through its feature the plan is. */
export type OnLine = OnNow & { progress: FeatureProgress | null };

export type RunnerCard = {
  night: DigestNight | null;
  on: OnLine[];
  /** Progress for the fallback line, the night's last fire, when no run is going. */
  progress: FeatureProgress | null;
  push: StoredPush | null;
  ready: number;
  /** The features the next ticks would fire, in the order they would fire them. */
  next: DigestNightRef[];
};

/** How many of the features waiting are named. The count says the rest. */
const NEXT_SHOWN = 3;

export function runnerCard(input: {
  run: OvernightRun | null;
  fires: readonly NightFire[];
  items: readonly PlanItem[];
  /** The whole tree, not a filtered view of it: what is ready is about the plan. */
  sections: readonly PlanSection[];
  /** The runs still going, as `loadStartedRuns` reads them. */
  started: readonly { planItemId: string; at: string }[];
  lastRuns: Iterable<{ reading: StoredRunReading | null }>;
  now?: number;
}): RunnerCard {
  const { run, items, sections } = input;
  const standing = overnightStanding(run);
  const live = standing === 'running' || standing === 'paused';

  // The stopped night is read too, so the card still says what the last run
  // did when nothing is running.
  const night =
    standing !== 'off' && run?.startedAt ? lastNightFrom({ run, fires: input.fires, items }) : null;

  // The last push only while the night is live. After it stops, the newest
  // push on the run rows can belong to a later session, and the card would
  // credit the night with it.
  const push = live && run?.startedAt ? lastStoredPush(input.lastRuns, run.startedAt) : null;

  // The runs still marked going, less the ones `endQuietRuns` would write off:
  // the plan page sweeps before it reads, but Dash does not wait on that write,
  // so the same rule is read here instead of the sweep being waited for.
  const now = input.now ?? Date.now();
  const itemById = new Map(items.map((item) => [item.id, item]));
  const going = input.started.filter(
    (started) =>
      runEnd(
        { status: 'started', createdAt: started.at },
        itemById.get(started.planItemId) ?? null,
        now,
      ) === null,
  );

  const on = live
    ? onNow(going, items).map((line) => ({
        ...line,
        progress: featureProgress(items, line.ref),
      }))
    : [];
  const progress = live && night?.lastFire ? featureProgress(items, night.lastFire.ref) : null;

  // What would be fired next, read the way the chooser chooses, less anything
  // a session is already on.
  const busy = new Set([...on.map((line) => line.ref), night?.lastFire?.ref]);
  const next: DigestNightRef[] = [];
  const seen = new Set<string>();
  for (const step of workOrder(sections, { only: 'runner' })) {
    const feature = topFeatureOf(sections, step);
    const ref = `#${feature.number}`;
    if (seen.has(ref)) continue;
    seen.add(ref);
    if (live && busy.has(ref)) continue;
    next.push({ ref, title: oneLine(feature.title) });
    if (next.length === NEXT_SHOWN) break;
  }

  return { night, on, progress, push, ready: readyFeatureCount(sections), next };
}

/**
 * Dash's update on a feature (plan #1666), kept in `plan_updates`.
 *
 * At the end of a build or re-shape run on a feature, Dash writes a short
 * update on it: a health, two or three sentences on what moved, and how many
 * of the feature's steps were done before and after. The feature's page shows
 * the latest at the top of Overview, after Linear's project updates.
 *
 * The health is Dash's judgement, written with the update. It is a different
 * thing from the health each row derives from its status and what it waits on
 * (`planHealthOf` in tree.ts), which says where the work stands rather than
 * whether the feature is likely to land.
 *
 * The step counting is here rather than in the CLI so the CLI and its tests
 * count the same way: every step and substep beneath the feature, decisions
 * and setup jobs left out, since neither is work Dash builds, and dropped
 * steps left out, since they will never be done.
 */
import type { DevTone } from '@/components/dev/state-label';
import type { StatusGlyph } from '@/lib/status-glyphs';
import { parseSnapshot, type ProgressSnapshot } from '@/lib/progress-snapshot';
import { flatten, type PlanHealth, type PlanNode } from './tree';

export const PLAN_UPDATE_HEALTHS = ['on_track', 'at_risk', 'blocked'] as const;
export type PlanUpdateHealth = (typeof PLAN_UPDATE_HEALTHS)[number];

export function isPlanUpdateHealth(value: unknown): value is PlanUpdateHealth {
  return typeof value === 'string' && (PLAN_UPDATE_HEALTHS as readonly string[]).includes(value);
}

/** The longest body the table takes: two or three sentences, with room. */
export const PLAN_UPDATE_BODY_MAX = 1200;

/** How each health is drawn: a shape, a word and a tone, as StateLabel takes them. */
export const PLAN_UPDATE_HEALTH: Record<
  PlanUpdateHealth,
  { word: string; glyph: StatusGlyph; tone: DevTone }
> = {
  on_track: { word: 'On track', glyph: 'check', tone: 'positive' },
  at_risk: { word: 'At risk', glyph: 'dashed', tone: 'caution' },
  blocked: { word: 'Blocked', glyph: 'bar', tone: 'caution' },
};

export type PlanUpdate = {
  id: string;
  featureId: string;
  health: PlanUpdateHealth;
  body: string;
  stepsDoneBefore: number;
  stepsDoneAfter: number;
  stepsTotal: number;
  session: string | null;
  createdAt: string;
  /** What the feature stood at when this was written; null on updates from before plan #1832. */
  snapshot: ProgressSnapshot | null;
};

/** The columns `planUpdateFromRow` reads. */
export const PLAN_UPDATE_COLUMNS =
  'id, feature_id, health, body, steps_done_before, steps_done_after, steps_total, session, created_at, snapshot';

/** A row as the table returns it, or null when it is not one. */
export function planUpdateFromRow(row: Record<string, unknown>): PlanUpdate | null {
  const count = (value: unknown) => (typeof value === 'number' && value >= 0 ? value : null);
  const before = count(row.steps_done_before);
  const after = count(row.steps_done_after);
  const total = count(row.steps_total);
  if (
    typeof row.id !== 'string' ||
    typeof row.feature_id !== 'string' ||
    !isPlanUpdateHealth(row.health) ||
    typeof row.body !== 'string' ||
    before === null ||
    after === null ||
    total === null
  ) {
    return null;
  }
  const created = row.created_at;
  return {
    id: row.id,
    featureId: row.feature_id,
    health: row.health,
    body: row.body,
    stepsDoneBefore: before,
    stepsDoneAfter: after,
    stepsTotal: total,
    session: typeof row.session === 'string' ? row.session : null,
    createdAt: created instanceof Date ? created.toISOString() : String(created ?? ''),
    snapshot: parseSnapshot(row.snapshot),
  };
}

/** The steps an update counts: beneath the feature, built work, not dropped. */
export function countedSteps(feature: PlanNode): PlanNode[] {
  return flatten([feature]).filter(
    (node) =>
      node.id !== feature.id &&
      node.kind !== 'decision' &&
      node.kind !== 'setup' &&
      node.status !== 'dropped',
  );
}

/** How far back the first update on a feature counts from. */
export const FIRST_UPDATE_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * The counts an update records. `since` is when the last update was written,
 * or null for the first, which counts from a day before `now`. A step counts
 * as done before when it was done and finished by then.
 */
export function updateCounts(
  feature: PlanNode,
  since: string | null,
  now: number,
): { before: number; after: number; total: number } {
  const steps = countedSteps(feature);
  const cutoff = since ? Date.parse(since) : now - FIRST_UPDATE_LOOKBACK_MS;
  const done = steps.filter((step) => step.status === 'done');
  const before = done.filter(
    (step) => step.completedAt !== null && Date.parse(step.completedAt) <= cutoff,
  ).length;
  return { before, after: done.length, total: steps.length };
}

/**
 * The "progress since" line under an update: where the done count stands and
 * where it stood when the update before it was written.
 */
export function progressSince(update: Pick<PlanUpdate, 'stepsDoneBefore' | 'stepsDoneAfter' | 'stepsTotal'>): string {
  const { stepsDoneBefore: before, stepsDoneAfter: after, stepsTotal: total } = update;
  const steps = total === 1 ? 'step' : 'steps';
  const now = `${after} of ${total} ${steps} done`;
  if (after > before) return `${now}, up from ${before}.`;
  if (after < before) return `${now}, down from ${before}.`;
  return `${now}, no change.`;
}

/**
 * What changed in the steps between an update and the one before it, in words
 * for the Overview card (plan #1834). Null when there is no earlier update to
 * compare with.
 *
 * With a snapshot on both updates the added and removed steps are counted from
 * the ids of the open steps; a step that left the open list and was not
 * finished in between was taken out. Without one (updates written before the
 * snapshot existed) the stored totals give the net change instead.
 */
export function changeSincePrevious(
  update: Pick<PlanUpdate, 'stepsDoneAfter' | 'stepsTotal' | 'snapshot'>,
  earlier: Pick<PlanUpdate, 'stepsDoneAfter' | 'stepsTotal' | 'snapshot'> | null | undefined,
): string | null {
  if (!earlier) return null;
  const closed = update.stepsDoneAfter - earlier.stepsDoneAfter;
  let added: number;
  let removed: number;
  if (update.snapshot && earlier.snapshot) {
    const now = new Set(update.snapshot.openIds);
    const before = new Set(earlier.snapshot.openIds);
    const left = earlier.snapshot.openIds.filter((id) => !now.has(id)).length;
    added = update.snapshot.openIds.filter((id) => !before.has(id)).length;
    removed = Math.max(0, left - Math.max(closed, 0));
  } else {
    const net = update.stepsTotal - earlier.stepsTotal;
    added = Math.max(net, 0);
    removed = Math.max(-net, 0);
  }
  const noun = (n: number) => (n === 1 ? 'step' : 'steps');
  const parts: string[] = [];
  if (closed > 0) parts.push(`${closed} ${noun(closed)} closed`);
  if (closed < 0) parts.push(`${-closed} ${noun(-closed)} reopened`);
  if (added > 0) parts.push(`${added} added`);
  if (removed > 0) parts.push(`${removed} removed`);
  if (parts.length === 0) return 'No change in the steps since the update before.';
  return `Since the update before: ${parts.join(', ')}.`;
}

/** Days with no update after which a feature that is moving is overdue for one. */
export const UPDATE_OVERDUE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The health readings of a feature that is being worked. */
const MOVING: readonly PlanHealth[] = ['in_progress', 'working', 'quiet'];

/**
 * How many whole days a moving feature has gone without an update, once that
 * reaches seven; null when it is not moving or is not yet overdue. The clock
 * starts at its latest update, or at when it started if it has had none, and
 * a feature that never records a start of its own takes the first start among
 * its steps.
 */
export function updateOverdueDays(
  feature: Pick<PlanNode, 'startedAt' | 'children'>,
  health: PlanHealth,
  latestUpdateAt: string | null | undefined,
  now: number,
): number | null {
  if (!MOVING.includes(health)) return null;
  const starts = [feature.startedAt, ...flatten([...(feature.children ?? [])]).map((n) => n.startedAt)]
    .filter((at): at is string => Boolean(at))
    .map((at) => Date.parse(at))
    .filter((at) => !Number.isNaN(at));
  const since = latestUpdateAt
    ? Date.parse(latestUpdateAt)
    : feature.startedAt
      ? Date.parse(feature.startedAt)
      : starts.length > 0
        ? Math.min(...starts)
        : Number.NaN;
  if (Number.isNaN(since)) return null;
  const days = Math.floor((now - since) / DAY_MS);
  return days >= UPDATE_OVERDUE_DAYS ? days : null;
}

/** `updateOverdueDays` at the server's clock, for a page that renders it once. */
export function updateOverdueDaysNow(
  feature: Pick<PlanNode, 'startedAt' | 'children'>,
  health: PlanHealth,
  latestUpdateAt: string | null | undefined,
): number | null {
  return updateOverdueDays(feature, health, latestUpdateAt, Date.now());
}

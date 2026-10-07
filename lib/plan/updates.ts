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
import { flatten, type PlanNode } from './tree';

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
};

/** The columns `planUpdateFromRow` reads. */
export const PLAN_UPDATE_COLUMNS =
  'id, feature_id, health, body, steps_done_before, steps_done_after, steps_total, session, created_at';

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

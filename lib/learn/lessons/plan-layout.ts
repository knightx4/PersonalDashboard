import type { LaidOutUnit } from './lay-out-unit';
import { LAYOUT_RESERVE_MS, LESSON_HOLD_MS } from './top-up';

/**
 * Laying out a learning goal's plan ahead of time (plan #1143,
 * LEARN-LESSONS-SPEC "The plan page").
 *
 * A goal's lessons left Learn now for its plan, so nothing waits for its
 * ready ideas to run out before laying out its next unit. Instead the top-up
 * lays out each goal track's first unit that has no ideas yet, whether or not
 * the deck is short. The lay-out port splits each unit into pieces straight
 * after (plan #1140), so the plan page fills in unit by unit.
 *
 * It stays one unit ahead of the person and no further: the next unit is laid
 * out only once the latest one laid out has been started (`unitStarted`). Run
 * every hour without that, the pass laid out 80 pieces across four plans
 * before one was passed.
 *
 * At most `MAX_PLAN_LAYOUTS_PER_RUN` units a run, each on a different track so
 * the calls can run side by side. A track whose layout failed is held for a
 * day, as the lesson top-up holds one, so a fault is not paid for every hour.
 *
 * Pure: the reads, the model call and the hold are ports, supplied by
 * `inngest/learn/feed-top-up.ts`.
 */

/** Units laid out ahead in one run, at most. Each is a chain call of about a minute. */
export const MAX_PLAN_LAYOUTS_PER_RUN = 2;

/** The latest unit laid out on a track, as `unitStarted` reads it. */
export type LaidOutUnitUse = {
  /** The unit's pieces. */
  pieces: readonly { id: string; conceptIds: readonly string[]; passed: boolean }[];
  /** Pieces that have had a check question asked. */
  checkedPieceIds: ReadonlySet<string>;
  /** Concepts with a lesson card, which a piece's page writes when it is opened. */
  lessonConceptIds: ReadonlySet<string>;
};

/**
 * Whether the person has started a laid-out unit: a piece of it passed, asked
 * a check, or opened so that one of its ideas has a lesson. A unit with no
 * pieces has not been started, so the pass waits rather than laying out more
 * behind it.
 */
export function unitStarted(unit: LaidOutUnitUse): boolean {
  return unit.pieces.some(
    (piece) =>
      piece.passed ||
      unit.checkedPieceIds.has(piece.id) ||
      piece.conceptIds.some((conceptId) => unit.lessonConceptIds.has(conceptId)),
  );
}

/** A goal track with a unit still to lay out. */
export type PlanLayoutDue = { subjectId: string; subjectName: string };

export type PlanLayoutPorts = {
  /** Goal tracks, not held, with a unit that has no ideas yet, at most `limit`. */
  due(userId: string, limit: number): Promise<PlanLayoutDue[]>;
  /** Lay out the track's first unit with no ideas, and write its pieces. */
  layOut(userId: string, subjectId: string): Promise<LaidOutUnit>;
  /** Leave the track's layout alone until `until`. */
  hold(userId: string, subjectId: string, until: Date): Promise<void>;
  now(): number;
};

export type PlanLayoutSummary = {
  /** Tracks a unit was laid out for. */
  laidOut: string[];
  failed: string[];
  held: string[];
  stopped: 'deadline' | null;
};

/** Lay out the next unit of up to two goal tracks. Throws only when `due` does. */
export async function layOutPlans(
  ports: PlanLayoutPorts,
  options: { userId: string; deadline: number },
): Promise<PlanLayoutSummary> {
  const { userId, deadline } = options;
  const summary: PlanLayoutSummary = { laidOut: [], failed: [], held: [], stopped: null };
  if (deadline - ports.now() < LAYOUT_RESERVE_MS) {
    summary.stopped = 'deadline';
    return summary;
  }

  const due = await ports.due(userId, MAX_PLAN_LAYOUTS_PER_RUN);
  const results = await Promise.all(
    due.map((one) =>
      ports.layOut(userId, one.subjectId).catch(
        (error: unknown): LaidOutUnit => ({
          outcome: 'failed',
          detail: error instanceof Error ? error.message : 'Laying out the unit failed.',
        }),
      ),
    ),
  );
  for (const [index, result] of results.entries()) {
    const one = due[index]!;
    if (result.outcome === 'laid-out') {
      summary.laidOut.push(one.subjectId);
      continue;
    }
    // Every unit was opened meanwhile: nothing to hold, and nothing is due next hour.
    if (result.outcome === 'no-unit-left') continue;
    summary.failed.push(`${one.subjectName}: ${result.detail}`);
    try {
      await ports.hold(userId, one.subjectId, new Date(ports.now() + LESSON_HOLD_MS));
      summary.held.push(one.subjectId);
    } catch (error) {
      summary.failed.push(`${one.subjectName}: holding it failed: ${error instanceof Error ? error.message : error}`);
    }
  }
  return summary;
}

import type { AddedUnit } from './add-unit';
import type { LaidOutUnit } from './lay-out-unit';
import type { LessonPick, TrackNeed } from './choose';

/**
 * Filling Learn now with lessons (LEARN-LESSONS-SPEC, build step 1; plan #978).
 *
 * The top-up (inngest/learn/feed-top-up.ts) runs this before it writes any
 * section card. Of the cards the person is short, about four in five are
 * given to lessons: the chooser names a concept for each, units are laid out
 * for tracks that have none open, and a lesson is written for each concept
 * and stored as a ready card. The section cards then fill what is left, so one
 * card in five is still exploratory, and all of them are when the person has
 * no track with anything to teach.
 *
 * Everything outside is a port, so the arithmetic is tested without a
 * database or a model; `inngest/learn/lesson-top-up.ts` supplies the real ones.
 */

/** The share of new cards given to lessons. The rest are section cards. */
export const LESSON_SHARE = 0.8;

/** Units laid out in one run, at most. Each is a `generateChain` call of about a minute. */
export const MAX_LAYOUTS_PER_RUN = 2;

/** Units written after a track's last in one run, at most. Each is one short Sonnet call. */
export const MAX_UNITS_ADDED_PER_RUN = 2;

/**
 * Laying out is not started with less than this left before the deadline:
 * the chain call takes about a minute, and the lessons after it need time too.
 */
export const LAYOUT_RESERVE_MS = 90_000;

/**
 * How long a track is left alone after laying out its unit failed or found
 * no unit to open. Long enough that the hourly run does not pay for the same
 * failure every hour, short enough that a fixed fault is picked up the next day.
 */
export const LESSON_HOLD_MS = 24 * 60 * 60 * 1000;

/** Lessons written at once. Each is one model call. */
export const LESSON_CONCURRENCY = 4;

/** Lessons to write when `short` cards are wanted in all. */
export function lessonsWanted(short: number): number {
  return Math.max(0, Math.round(short * LESSON_SHARE));
}

export type LessonOutcome = 'ready' | 'dropped' | 'failed';

export type LessonTopUpPorts = {
  /** The chooser, with held tracks' needs already left out. */
  choose(userId: string, slots: number): Promise<{ picks: LessonPick[]; needs: TrackNeed[] }>;
  layOut(userId: string, subjectId: string): Promise<LaidOutUnit>;
  /** Write the unit after `lastUnitId`, the track's last when the need was read. */
  addUnit(userId: string, subjectId: string, lastUnitId: string | null): Promise<AddedUnit>;
  /** Leave the track's layout alone until `until`. */
  hold(userId: string, subjectId: string, until: Date): Promise<void>;
  /** Write one lesson and store its row. */
  write(userId: string, pick: LessonPick): Promise<{ outcome: LessonOutcome; detail?: string }>;
  now(): number;
};

export type LessonTopUpSummary = {
  wanted: number;
  chosen: number;
  written: number;
  dropped: string[];
  failed: string[];
  /** Tracks a unit was written for, after their last. */
  added: string[];
  /** Tracks a unit was laid out for. */
  laidOut: string[];
  /** Tracks put on hold this run. */
  held: string[];
  stopped: 'deadline' | null;
};

/**
 * Write up to `wanted` lessons for one person, and return what came of it.
 *
 * A track that has run out of units, or is on its last with fewer than
 * three concepts left, or has no curriculum, first gets its next unit written
 * (plan #969). Then units are laid out for tracks whose next unit has no chain
 * (`no-chain`), which includes a unit just written for a track with every unit
 * done. The chooser is asked again after each of the two when it changed
 * anything, so new concepts can take slots in the same run.
 *
 * A track whose unit could not be written or laid out is held for a day.
 */
export async function writeLessonsFor(
  ports: LessonTopUpPorts,
  options: { userId: string; wanted: number; deadline: number },
): Promise<LessonTopUpSummary> {
  const { userId, wanted, deadline } = options;
  const summary: LessonTopUpSummary = {
    wanted,
    chosen: 0,
    written: 0,
    dropped: [],
    failed: [],
    added: [],
    laidOut: [],
    held: [],
    stopped: null,
  };
  if (wanted <= 0) return summary;

  const hold = async (need: TrackNeed) => {
    try {
      await ports.hold(userId, need.subjectId, new Date(ports.now() + LESSON_HOLD_MS));
      summary.held.push(need.subjectId);
    } catch (error) {
      summary.failed.push(`${need.subjectName}: holding it failed: ${error instanceof Error ? error.message : error}`);
    }
  };

  let choice = await ports.choose(userId, wanted);

  const toAdd = choice.needs.filter((need) => need.because !== 'no-chain').slice(0, MAX_UNITS_ADDED_PER_RUN);
  if (toAdd.length > 0 && deadline - ports.now() >= LAYOUT_RESERVE_MS) {
    const results = await Promise.all(toAdd.map((need) => ports.addUnit(userId, need.subjectId, need.unitId)));
    for (const [index, result] of results.entries()) {
      const need = toAdd[index]!;
      if (result.outcome === 'added') summary.added.push(need.subjectId);
      else if (result.outcome === 'failed') {
        summary.failed.push(`${need.subjectName}: ${result.detail}`);
        await hold(need);
      }
    }
    if (summary.added.length > 0) choice = await ports.choose(userId, wanted);
  }

  const toLayOut = choice.needs.filter((need) => need.because === 'no-chain').slice(0, MAX_LAYOUTS_PER_RUN);
  if (toLayOut.length > 0 && deadline - ports.now() >= LAYOUT_RESERVE_MS) {
    // Different tracks, so the calls can run side by side.
    const results = await Promise.all(toLayOut.map((need) => ports.layOut(userId, need.subjectId)));
    for (const [index, result] of results.entries()) {
      const need = toLayOut[index]!;
      if (result.outcome === 'laid-out') {
        summary.laidOut.push(need.subjectId);
        continue;
      }
      if (result.outcome === 'failed') summary.failed.push(`${need.subjectName}: ${result.detail}`);
      await hold(need);
    }
    if (summary.laidOut.length > 0) choice = await ports.choose(userId, wanted);
  }

  summary.chosen = choice.picks.length;
  for (let start = 0; start < choice.picks.length; start += LESSON_CONCURRENCY) {
    if (ports.now() >= deadline) {
      summary.stopped = 'deadline';
      break;
    }
    const batch = choice.picks.slice(start, start + LESSON_CONCURRENCY);
    const results = await Promise.all(
      batch.map((pick) =>
        ports.write(userId, pick).catch((error: unknown) => ({
          outcome: 'failed' as const,
          detail: error instanceof Error ? error.message : 'failed',
        })),
      ),
    );
    for (const [index, result] of results.entries()) {
      const name = batch[index]!.concept.name;
      if (result.outcome === 'ready') summary.written += 1;
      else if (result.outcome === 'dropped') summary.dropped.push(`${name}: ${result.detail ?? 'dropped'}`);
      else summary.failed.push(`${name}: ${result.detail ?? 'failed'}`);
    }
  }
  return summary;
}

/** Prerequisites the why line names, at most. */
const WHY_PREREQUISITES = 2;

/**
 * The line above a lesson's title, built here rather than by the model so it
 * always names the right track: "Next in your Economics track. It builds on
 * Supply and Demand curves."
 */
export function lessonWhy(trackName: string, prerequisites: readonly string[]): string {
  const lead = `Next in your ${trackName.trim()} track.`;
  const named = prerequisites.map((name) => name.trim()).filter(Boolean);
  if (named.length === 0) return lead;
  const shown = named.slice(0, WHY_PREREQUISITES);
  const more = named.length - shown.length;
  const list =
    more > 0
      ? `${shown.join(', ')} and ${more} more`
      : shown.length === 2
        ? `${shown[0]} and ${shown[1]}`
        : shown[0]!;
  return `${lead} It builds on ${list}.`;
}

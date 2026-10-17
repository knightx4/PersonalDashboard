import type { KnowledgeState } from '@/lib/learn/graph/model';
import { isHeld, type Readings } from '@/lib/learn/levels/model';
import type { StrengthInput } from '@/lib/learn/strength';

/**
 * A prepared topic as a star on Idea Space (plan #2317.2). Pure, so the
 * lighting can be tested without the database.
 *
 * The sky lights a star from a state row (lib/learn/map/sky.ts `lightOn`):
 * brightness from answers, the halo from evidence and your word, haze from
 * the tested stars beside it. A topic has no state row of its own; its
 * standing is its cells' readings. This reads one off them so the sky, the
 * timeline and the card light a topic the way they light anything else:
 *
 * - A topic with a level shown by an answer is tested, from the newest answer
 *   holding its highest shown level, at a state that grows with the share of
 *   its ladder shown.
 * - A topic held without an answer (inferred from another topic, or your
 *   word) is untested, so it rings and does not brighten.
 * - A topic with nothing held has no row, and is dark.
 */

/** The share of a topic's ladder from which its state reads `sharp`, then `known`; below, `recognised`. */
export const SHARP_FROM = 0.85;
export const KNOWN_FROM = 0.5;

/** The state a share of the ladder reads as: never `unknown` or `shaky` for a level held. */
export function stateForShare(share: number): KnowledgeState {
  if (share >= SHARP_FROM) return 'sharp';
  if (share >= KNOWN_FROM) return 'known';
  return 'recognised';
}

/** The levels a topic holds: the highest shown by an answer, the highest held at all, and its ceiling. */
export type TopicLevels = { tested: number; held: number; ceiling: number };

/**
 * The levels in words, tested and held apart (docs/LEARN-LEVELS-SPEC.md, "How
 * counts are reported"): "4 of 10 held, 2 tested".
 */
export function levelsText(levels: TopicLevels): string {
  if (levels.held <= 0) return `None of ${levels.ceiling} held`;
  const of = `${levels.held} of ${levels.ceiling} held`;
  if (levels.tested >= levels.held) return `${of}, all tested`;
  return levels.tested > 0 ? `${of}, ${levels.tested} tested` : `${of}, none tested`;
}

/** A topic's state row from its cells' readings, and the levels it was read from. */
export function topicStanding(
  topicId: string,
  ceiling: number,
  readings: Readings,
): { stateRow: StrengthInput | null; levels: TopicLevels } {
  let shown: { level: number; since: string | null } | null = null;
  let held: { level: number; since: string | null; declared: boolean } | null = null;
  for (const reading of readings.values()) {
    if (reading.topicId !== topicId || !isHeld(reading.status)) continue;
    if (reading.status === 'shown' && (!shown || reading.level > shown.level)) {
      shown = { level: reading.level, since: reading.heldSince };
    }
    if (!held || reading.level > held.level) {
      held = { level: reading.level, since: reading.heldSince, declared: reading.status === 'declared' };
    }
  }
  const top = Math.max(ceiling, 1);
  const levels: TopicLevels = { tested: shown?.level ?? 0, held: Math.max(held?.level ?? 0, shown?.level ?? 0), ceiling };
  if (shown) {
    return {
      levels,
      stateRow: {
        state: stateForShare(Math.min(shown.level, top) / top),
        established: 'tested',
        tested_at: shown.since,
        declared_at: null,
        review_interval_days: null,
      },
    };
  }
  if (held) {
    return {
      levels,
      stateRow: {
        state: stateForShare(Math.min(held.level, top) / top),
        established: held.declared ? 'declared' : 'inferred',
        tested_at: null,
        declared_at: held.since,
        review_interval_days: null,
      },
    };
  }
  return { levels, stateRow: null };
}

import 'server-only';

import type { SpendSink } from '@/lib/core/spend/pricing';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import {
  findNearestSegments,
  type NearbySegment,
  type NearestOutcome,
} from '@/lib/learn/catalogue/nearest';
import type { EmbeddingClient } from '@/lib/learn/embed/voyage';

/**
 * The catalogue section a lesson is checked against (LEARN-LESSONS-SPEC, "A
 * lesson"): the one segment closest to the concept's claim, when one is close
 * enough, and null otherwise.
 *
 * The claim is embedded as a query and the catalogue read through
 * `findNearestSegments`, the same path the read button's search takes. Nothing
 * is judged here and no link is written. The lesson call reads the section and
 * says whether it is about the claim at all, so a section that passes the
 * floor and turns out to be about something else costs the input tokens of one
 * segment and is then left off the lesson.
 */

/**
 * How close the nearest segment has to be to be passed to the lesson call.
 *
 * Set from the live catalogue on 24 September 2026: 1,714 segments and 107
 * concept claims, all embedded by voyage-4-lite. The nearest segment to each
 * claim scored between 0.39 and 0.62. Below 0.55 the nearest segment was
 * almost never about the claim (the motherhood penalty came back as a section
 * of "Private equity" at 0.549, 0.536 and 0.526). From 0.55 up, roughly half
 * were about the claim ("CHIPS and Science Act", Manufacturing, for claims
 * about chip shortages at 0.589 and 0.605) and the rest were about a neighbouring
 * subject. So 0.55 cuts the bulk of the unrelated matches and keeps the real
 * ones seen, and the lesson call's own check catches what gets through.
 *
 * Those claims were embedded as documents and a lesson's claim is embedded as
 * a query, which moves scores by a few hundredths. The catalogue's default of
 * 0.5 is lower because a judging call follows every candidate there; here the
 * section goes straight into the lesson, so the floor is stricter.
 */
export const LESSON_SOURCE_MIN_SIMILARITY = 0.55;

/** The section a lesson was checked against, with what the lesson shows and cites. */
export type LessonSource = {
  segmentId: string;
  /** The catalogue item the segment is in, which the lesson's row points at. */
  itemId: string;
  itemTitle: string;
  /** The section heading, or null for a lead or a timed segment. */
  heading: string | null;
  url: string;
  sectionAnchor: string | null;
  text: string;
  similarity: number;
};

function toLessonSource(segment: NearbySegment): LessonSource {
  return {
    segmentId: segment.segmentId,
    itemId: segment.itemId,
    itemTitle: segment.item.title,
    heading: segment.heading,
    url: segment.item.canonicalUrl,
    sectionAnchor: segment.sectionAnchor,
    text: segment.text,
    similarity: segment.similarity,
  };
}

/**
 * The closest segment above the floor, or null.
 *
 * Pure, and exported for the test. A failed search is the same answer as an
 * empty one: the lesson is written from the model's knowledge alone.
 */
export function closestFrom(
  outcome: NearestOutcome,
  floor = LESSON_SOURCE_MIN_SIMILARITY,
): LessonSource | null {
  if (!outcome.ok) return null;
  const best = outcome.segments.find(
    (segment) => Number.isFinite(segment.similarity) && segment.similarity >= floor && segment.text.trim(),
  );
  return best ? toLessonSource(best) : null;
}

/**
 * Find the closest catalogue section to a claim. Never throws; null on any
 * failure and when nothing is close enough.
 *
 * The embedding spend goes to `onSpend`, for the caller to record under
 * 'embed-lesson-claim' with the rest of the lesson's spend.
 */
export async function findLessonSource(
  supabase: LearnSupabaseClient,
  claim: string,
  options: {
    onSpend?: SpendSink;
    apiKey?: string | null;
    client?: EmbeddingClient;
    /** Replaces the live search, for the test. */
    find?: typeof findNearestSegments;
  } = {},
): Promise<LessonSource | null> {
  const text = claim.trim();
  if (!text) return null;
  const find = options.find ?? findNearestSegments;
  try {
    const outcome = await find(supabase, text, {
      limit: 1,
      minSimilarity: LESSON_SOURCE_MIN_SIMILARITY,
      onSpend: options.onSpend,
      apiKey: options.apiKey,
      client: options.client,
    });
    if (!outcome.ok) {
      console.error(`[lesson source] ${outcome.reason}: ${outcome.detail}`);
      return null;
    }
    return closestFrom(outcome);
  } catch (error) {
    console.error('[lesson source]', error instanceof Error ? error.message : error);
    return null;
  }
}

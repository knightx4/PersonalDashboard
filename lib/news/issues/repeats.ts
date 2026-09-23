import type { NewsStory } from './stories';

/**
 * Finding stories that two newsletters both told (plan #872).
 *
 * The measurement behind #862's matching: every pair of stories from
 * different newsletters that arrived close together, with how alike their
 * embeddings are. Nothing here reaches a network or a database, so the script
 * that prints the result (scripts/news-repeats.ts) and the step that will
 * store matches (#864) can share it.
 */

/** Two stories further apart than this in arrival are never compared. */
export const REPEAT_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

/** The cut-offs #872 measures, lowest first. */
export const REPEAT_CUTOFFS = [0.7, 0.75, 0.8, 0.85, 0.9] as const;

/** One story, with where it came from. */
export type PlacedStory = {
  issueId: string;
  /** Which story in the issue's `stories` array, the same index a pass uses. */
  index: number;
  /** The newsletter. Two stories with the same sender are never a pair. */
  senderId: string;
  senderName: string;
  receivedAt: number;
  story: NewsStory;
};

/**
 * What is embedded for a story: its headline, then its summary.
 *
 * Both, because a headline on its own is often a pun or a teaser that shares
 * no words with another newsletter's headline for the same event, and the
 * summary is where the event is named plainly.
 */
export function repeatText(story: NewsStory): string {
  return `${story.headline}\n${story.summary}`;
}

/** Cosine similarity. Zero for a vector with no length, rather than NaN. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length)
    throw new Error(`vectors differ in width: ${a.length} and ${b.length}`);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}

export type StoryPair = { a: PlacedStory; b: PlacedStory; similarity: number };

/**
 * Every pair from different newsletters, arrived within the window, at or
 * above `floor`. Most similar first.
 *
 * `vectors[i]` belongs to `stories[i]`. Every pair is compared, which for a
 * week of one person's newsletters is a few thousand dot products.
 */
export function similarPairs(
  stories: PlacedStory[],
  vectors: number[][],
  floor: number,
  windowMs: number = REPEAT_WINDOW_MS,
): StoryPair[] {
  if (vectors.length !== stories.length) {
    throw new Error(`${vectors.length} vectors for ${stories.length} stories`);
  }
  const pairs: StoryPair[] = [];
  for (let i = 0; i < stories.length; i += 1) {
    for (let j = i + 1; j < stories.length; j += 1) {
      const a = stories[i];
      const b = stories[j];
      if (a.senderId === b.senderId) continue;
      if (Math.abs(a.receivedAt - b.receivedAt) > windowMs) continue;
      const similarity = cosine(vectors[i], vectors[j]);
      if (similarity >= floor) pairs.push({ a, b, similarity });
    }
  }
  return pairs.sort((x, y) => y.similarity - x.similarity);
}

export type RepeatBand = {
  /** Inclusive. */
  from: number;
  /** Exclusive, or null for the top band, which runs to 1. */
  to: number | null;
  pairs: StoryPair[];
};

/**
 * The pairs split between consecutive cut-offs: 0.70 to 0.75, and so on, with
 * the last band running from the highest cut-off to 1. A pair below the
 * lowest cut-off is in no band.
 */
export function bandPairs(
  pairs: StoryPair[],
  cutoffs: readonly number[] = REPEAT_CUTOFFS,
): RepeatBand[] {
  const sorted = [...cutoffs].sort((x, y) => x - y);
  return sorted.map((from, i) => {
    const to = i + 1 < sorted.length ? sorted[i + 1] : null;
    return {
      from,
      to,
      pairs: pairs.filter(
        (pair) => pair.similarity >= from && (to === null || pair.similarity < to),
      ),
    };
  });
}

/** How many pairs clear each cut-off. */
export function countsAtCutoffs(
  pairs: StoryPair[],
  cutoffs: readonly number[] = REPEAT_CUTOFFS,
): { cutoff: number; pairs: number }[] {
  return cutoffs.map((cutoff) => ({
    cutoff,
    pairs: pairs.filter((pair) => pair.similarity >= cutoff).length,
  }));
}

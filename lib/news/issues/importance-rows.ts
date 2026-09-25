import { readImportance } from './stories';

/**
 * The pure half of importance.ts: which stored stories still need a rating,
 * and writing ratings back into the stored array without moving anything.
 */

/** A stored story without a rating, by its position in the stored array. */
export type Unrated = { index: number; headline: string; summary: string; topic: string | null };

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * The stories in a stored array that have a headline and summary and no valid
 * rating, numbered by their position in the array. Anything that is not an
 * array has none.
 */
export function unrated(stories: unknown): Unrated[] {
  if (!Array.isArray(stories)) return [];
  const found: Unrated[] = [];
  stories.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const raw = entry as Record<string, unknown>;
    const headline = text(raw.headline);
    const summary = text(raw.summary);
    if (!headline || !summary || readImportance(raw.importance)) return;
    found.push({ index, headline, summary, topic: text(raw.topic) });
  });
  return found;
}

/**
 * `stories` with each rating written onto the entry it names. A rating is
 * used only when its number is one of `asked` and the entry at that position
 * still carries the headline it was asked about, and only when it is a whole
 * number from 1 to 5. Everything else in the array is left as it was.
 */
export function applyRatings(
  stories: unknown,
  asked: readonly Unrated[],
  ratings: unknown,
): { stories: unknown; rated: number } {
  if (!Array.isArray(stories) || !Array.isArray(ratings)) return { stories, rated: 0 };
  const byIndex = new Map(asked.map((story) => [story.index, story.headline]));
  const next = [...stories];
  let rated = 0;
  for (const rating of ratings) {
    if (!rating || typeof rating !== 'object') continue;
    const { number, importance } = rating as Record<string, unknown>;
    const value = readImportance(importance);
    if (typeof number !== 'number' || !value || !byIndex.has(number)) continue;
    const entry = next[number];
    if (!entry || typeof entry !== 'object') continue;
    if (text((entry as Record<string, unknown>).headline) !== byIndex.get(number)) continue;
    next[number] = { ...(entry as object), importance: value };
    byIndex.delete(number);
    rated += 1;
  }
  return { stories: next, rated };
}

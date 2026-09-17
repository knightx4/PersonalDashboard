/**
 * Whether an idea has already been filed.
 *
 * Sessions reading the same code reach the same thought, and each one wrote
 * it down without looking at the list first: 53 of the 55 open ideas were
 * filed by sessions over four days, several of them the same suggestion in
 * different words. This is what `scripts/plan.ts idea` checks before it
 * inserts.
 *
 * Pure and here rather than in the script so the threshold is pinned by
 * tests. A wrong refusal costs a real suggestion, so the bar is high: two
 * bodies have to share most of their content words before one is read as the
 * other.
 */

/** Below this, two ideas are different suggestions. */
export const IDEA_DUPLICATE_MIN = 0.7;

/**
 * Fewer content words than this on either side and overlap carries no signal
 * — "Sort the ideas page" and "Group the ideas page" share two words out of
 * three. A short idea has to match word for word to be refused.
 */
const SHORT_IDEA_WORDS = 4;

/** Words every idea uses, which say nothing about which idea it is. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at',
  'by', 'for', 'with', 'from', 'into', 'over', 'as', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'it', 'its', 'this', 'that', 'these',
  'those', 'there', 'here', 'what', 'which', 'when', 'where', 'who', 'how',
  'so', 'than', 'then', 'not', 'no', 'can', 'could', 'should', 'would',
  'will', 'do', 'does', 'did', 'has', 'have', 'had', 'you', 'your', 'we',
  'our', 'they', 'their', 'one', 'also', 'any', 'all', 'each', 'more',
  'most', 'some', 'up', 'out', 'about', 'again', 'still', 'only', 'just',
]);

/** An idea reduced to the words that say which idea it is. */
export function ideaWords(body: string): Set<string> {
  const words = body
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, ' ')
    .split(' ')
    .filter((word) => word && !STOPWORDS.has(word));
  return new Set(words);
}

/**
 * Dice coefficient over the two word sets, 0 to 1.
 *
 * Word-level rather than character-level, and orderless, for the same reason
 * lib/jobs/ats/match.ts is: the thing being compared is a sentence somebody
 * rewrote, so "Refuse a duplicate idea" and "An idea that duplicates one
 * already there is refused" have to come out close.
 */
export function ideaSimilarity(a: string, b: string): number {
  const left = ideaWords(a);
  const right = ideaWords(b);
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  const score = (2 * shared) / (left.size + right.size);

  if (Math.min(left.size, right.size) < SHORT_IDEA_WORDS) return score === 1 ? 1 : 0;
  return score;
}

/** An idea already on the page, as much of it as the comparison needs. */
export interface FiledIdea {
  id: string;
  body: string;
}

export interface IdeaMatch {
  idea: FiledIdea;
  score: number;
}

/**
 * The idea this one is a rewrite of, or null if it is new.
 *
 * The best match wins, so the refusal names the closest thing on the list
 * rather than the first row that crossed the line.
 */
export function findDuplicateIdea(body: string, filed: readonly FiledIdea[]): IdeaMatch | null {
  let best: IdeaMatch | null = null;
  for (const idea of filed) {
    const score = ideaSimilarity(body, idea.body);
    if (score >= IDEA_DUPLICATE_MIN && (!best || score > best.score)) best = { idea, score };
  }
  return best;
}

/** The first line of an idea, which is how one is named in a refusal. */
export function ideaFirstLine(body: string, max = 70): string {
  const line = body.split('\n')[0].trim().replace(/\s+/g, ' ');
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

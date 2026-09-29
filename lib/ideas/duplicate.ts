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
 * Two first lines at or above this name the same idea, whatever the
 * paragraph beneath says.
 *
 * The morning run filed the same two observations five times between 25 and
 * 29 September (lib/ideas/fixtures/morning-repeats.ts): the headline came back
 * nearly word for word and the paragraph under it was written fresh each
 * morning, which pulled the whole bodies down to 0.41-0.58 while the first
 * lines scored 0.80-1.00. Higher than the whole-body bar because a headline
 * is short, so each shared word counts for more.
 */
export const IDEA_FIRST_LINE_MIN = 0.8;

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
  /** The score that crossed its bar: the whole body's, or else the first line's. */
  score: number;
  /** Which comparison caught it, so a refusal can say what was the same. */
  on: 'body' | 'first line';
}

/** The first line of an idea, whole, for comparing. */
function headline(body: string): string {
  return body.split('\n')[0].trim();
}

/**
 * The idea this one is a rewrite of, or null if it is new.
 *
 * Two ways to be the same idea: most of the whole body shared, or the first
 * line shared under a reworded paragraph. Shared #numbers alone are not one:
 * the follow-ons sessions filed from #669 on 19 September name the same rows
 * and are different ideas.
 *
 * The best match wins, so the refusal names the closest thing on the list
 * rather than the first row that crossed the line. Closest is by the whole
 * body first, and the first line only breaks a tie.
 */
export function findDuplicateIdea(body: string, filed: readonly FiledIdea[]): IdeaMatch | null {
  const line = headline(body);
  let best: (IdeaMatch & { whole: number; firstLine: number }) | null = null;
  for (const idea of filed) {
    const whole = ideaSimilarity(body, idea.body);
    const firstLine = ideaSimilarity(line, headline(idea.body));
    const on = whole >= IDEA_DUPLICATE_MIN ? 'body' : firstLine >= IDEA_FIRST_LINE_MIN ? 'first line' : null;
    if (!on) continue;
    const closer =
      !best || whole > best.whole || (whole === best.whole && firstLine > best.firstLine);
    if (closer) best = { idea, score: on === 'body' ? whole : firstLine, on, whole, firstLine };
  }
  return best && { idea: best.idea, score: best.score, on: best.on };
}

/** The first line of an idea, which is how one is named in a refusal. */
export function ideaFirstLine(body: string, max = 70): string {
  const line = body.split('\n')[0].trim().replace(/\s+/g, ' ');
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

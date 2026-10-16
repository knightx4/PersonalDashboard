import type { KnowledgeState, StateBasis } from '@/lib/learn/graph/model';

/**
 * The same idea in two subjects (plan #2147.2).
 *
 * Two ideas whose vectors are at least SIMILAR_PAIR_THRESHOLD alike and that
 * sit in different subjects are listed once, as a pair, until the person
 * settles it: merge them into one idea, or keep both. Closeness only finds
 * the pair. Nothing is merged and nothing in `learn.concept_state` is written
 * until they press one of the two, and the database functions that do it
 * (`learn.merge_ideas`, `learn.keep_both_ideas`) live in migrations 0153 and
 * 0154.
 *
 * Pure: the loader in `idea-pairs-load.ts` reads the rows, and this says what
 * the page shows about them.
 */

export type PairSubject = { id: string; name: string };

export type PairIdea = {
  id: string;
  name: string;
  claim: string;
  subject: PairSubject;
  /** Null for an idea never answered about or declared. */
  state: KnowledgeState | null;
  established: StateBasis | null;
  /** Questions answered about it. */
  answers: number;
  /** Prerequisite links in its subject, either way round. */
  links: number;
};

export type IdeaPair = { a: PairIdea; b: PairIdea; similarity: number };

/** What keeping both would carry across, worked out the way `keep_both_ideas` does. */
export type Carry = { from: PairIdea; to: PairIdea; state: KnowledgeState };

/** The list of pairs. */
export const PAIRS_HREF = '/learn/space/pairs';

/** One pair's page. The ids go lower first, as the pair function returns them. */
export function pairHref(a: string, b: string): string {
  return a < b ? `${PAIRS_HREF}/${a}/${b}` : `${PAIRS_HREF}/${b}/${a}`;
}

/** The cosine similarity as a whole percentage, which reads more easily than 0.94. */
export function similarityPercent(similarity: number): string {
  return `${Math.round(similarity * 100)}%`;
}

const BASIS_RANK: Record<StateBasis, number> = { tested: 3, declared: 2, inferred: 1 };

/** A state that holds the idea, which is the only kind a carry passes on. */
function holds(state: KnowledgeState | null): boolean {
  return state === 'recognised' || state === 'known' || state === 'sharp';
}

/**
 * Which of the two the merge keeps unless the person picks the other: the
 * one with more behind it. Better evidence first, then more answers, then a
 * name written as a sentence over one written as an identifier, then more
 * links (the merged-away idea's links cannot follow it into another subject,
 * so keeping the better-linked one loses fewer).
 */
export function suggestedKeep(pair: IdeaPair): PairIdea {
  const score = (idea: PairIdea) => [
    idea.established ? BASIS_RANK[idea.established] : 0,
    idea.answers,
    /\s/.test(idea.name) ? 1 : 0,
    idea.links,
  ];
  const a = score(pair.a);
  const b = score(pair.b);
  for (let i = 0; i < a.length; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]! ? pair.a : pair.b;
  }
  return pair.a;
}

/**
 * What keeping both would carry: a tested result that holds the idea, onto
 * the other when it has no state of its own. Null when there is nothing to
 * carry, which is most pairs.
 */
export function keepBothCarry(pair: IdeaPair): Carry | null {
  const carries = (from: PairIdea, to: PairIdea) =>
    from.established === 'tested' && holds(from.state) && to.state === null;
  if (carries(pair.a, pair.b)) return { from: pair.a, to: pair.b, state: pair.a.state! };
  if (carries(pair.b, pair.a)) return { from: pair.b, to: pair.a, state: pair.b.state! };
  return null;
}

const STATE_WORDS: Record<KnowledgeState, string> = {
  unknown: 'Not known yet',
  shaky: 'Shaky',
  recognised: 'Recognised',
  known: 'Known',
  sharp: 'Sharp',
  misconception: 'Misconception',
};

const BASIS_WORDS: Record<StateBasis, string> = {
  tested: 'tested',
  declared: 'you said so',
  inferred: 'inferred',
};

/** A state in words: "Known". */
export function stateWord(state: KnowledgeState): string {
  return STATE_WORDS[state];
}

/** Where an idea stands, in words: "Known, tested", or "Not answered yet". */
export function standingText(idea: Pick<PairIdea, 'state' | 'established'>): string {
  if (!idea.state || !idea.established) return 'Not answered yet';
  return `${STATE_WORDS[idea.state]}, ${BASIS_WORDS[idea.established]}`;
}

/** "1 answer", "3 answers". */
export function answersText(count: number): string {
  return `${count} ${count === 1 ? 'answer' : 'answers'}`;
}

/** "1 link", "3 links". */
export function linksText(count: number): string {
  return `${count} ${count === 1 ? 'link' : 'links'}`;
}

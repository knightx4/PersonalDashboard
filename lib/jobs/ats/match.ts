import type { FetchedPosting } from './types';

/**
 * Which posting on a board is the one you applied to.
 *
 * Pure, and the most consequential judgement in the backfill: everything else
 * is plumbing around this decision. Writing the wrong job description onto a
 * role is worse than writing none, because a blank JD panel says "missing" and
 * a wrong one says nothing at all — it just quietly misinforms the requirement
 * mapping, the seniority guess and every answer drafted against it.
 *
 * So the bar is deliberately high and ambiguity is a first-class outcome
 * rather than a coin toss, in the same spirit as the inbox linker: a missed
 * match costs one paste, a wrong match costs trust in the whole panel.
 */

/** Below this, two titles are not the same job. */
export const FUZZY_MIN = 0.72;

/**
 * How far clear the best candidate has to be. "Software Engineer, Payments"
 * and "Software Engineer, Payouts" score close to each other and to your role,
 * and picking whichever sorted first is exactly the silent error above.
 */
export const AMBIGUOUS_MARGIN = 0.08;

export interface RoleToMatch {
  title: string;
  atsJobId: string | null;
}

export type BoardMatch =
  | { kind: 'id'; posting: FetchedPosting }
  | { kind: 'exact'; posting: FetchedPosting }
  | { kind: 'fuzzy'; posting: FetchedPosting; score: number }
  | { kind: 'ambiguous'; candidates: FetchedPosting[] }
  | { kind: 'none' };

/** Words that carry no signal about which job this is. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'or', 'for', 'to', 'at', 'in', 'on', 'with',
  'our', 'we', 'you', 'is', 'are',
]);

/**
 * A title reduced to the words that identify the job.
 *
 * Boards decorate titles in ways that mean nothing: a location suffix, a
 * requisition id, "(Remote)", an em-dash and the team name. Two records of the
 * same job routinely differ by all of those and by none of the words that
 * matter.
 */
export function normalizeTitle(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Bracketed decoration: "(Remote)", "[London]", "(f/m/d)".
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    // Requisition ids, in the several shapes boards write them.
    .replace(/\b(req|job|jr|r)[-_\s]?\d{3,}\b/g, ' ')
    .replace(/#\s?\d{3,}\b/g, ' ')
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/[^a-z0-9+#]+/g, ' ')
    .split(' ')
    .filter((word) => word && !STOPWORDS.has(word))
    .join(' ')
    .trim();
}

/**
 * Dice coefficient over the two word sets.
 *
 * Chosen over edit distance because the failure mode here is word-level, not
 * character-level: "Senior Backend Engineer" against "Backend Engineer, Senior"
 * is the same job, and any distance metric that respects order says otherwise.
 */
export function titleSimilarity(a: string, b: string): number {
  const left = new Set(normalizeTitle(a).split(' ').filter(Boolean));
  const right = new Set(normalizeTitle(b).split(' ').filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return (2 * shared) / (left.size + right.size);
}

export function matchPosting(role: RoleToMatch, postings: FetchedPosting[]): BoardMatch {
  // The id is the only identifier either side agrees on, so when we have one it
  // ends the question — no title is consulted and no threshold applies.
  if (role.atsJobId) {
    const wanted = role.atsJobId.toLowerCase();
    const byId = postings.find((posting) => posting.atsJobId?.toLowerCase() === wanted);
    if (byId) return { kind: 'id', posting: byId };
  }

  const normalized = normalizeTitle(role.title);
  if (!normalized) return { kind: 'none' };

  const exact = postings.filter((posting) => normalizeTitle(posting.title) === normalized);
  if (exact.length === 1) return { kind: 'exact', posting: exact[0] };
  // Two postings with the same title is a real thing — the same role open in
  // two locations. Nothing here can tell them apart, and guessing is the one
  // outcome not on offer.
  if (exact.length > 1) return { kind: 'ambiguous', candidates: exact };

  const scored = postings
    .map((posting) => ({ posting, score: titleSimilarity(role.title, posting.title) }))
    .filter((entry) => entry.score >= FUZZY_MIN)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { kind: 'none' };

  const [best, runnerUp] = scored;
  if (runnerUp && best.score - runnerUp.score < AMBIGUOUS_MARGIN) {
    return {
      kind: 'ambiguous',
      candidates: scored
        .filter((entry) => best.score - entry.score < AMBIGUOUS_MARGIN)
        .map((entry) => entry.posting),
    };
  }

  return { kind: 'fuzzy', posting: best.posting, score: best.score };
}

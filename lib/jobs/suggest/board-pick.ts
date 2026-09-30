import { isSimilarTitle } from './history';
import { companyKey, isExcluded, roleKey } from './payload';

/**
 * Which postings on the followed companies' own boards go to the roles
 * search as candidates (see boards.ts).
 *
 * A board holds every job at the company, so most of it is beside the point.
 * A posting goes forward when its title is like a target title or a role the
 * person saved or heard back from (the same kind of work, within one level;
 * `isSimilarTitle`), and it is not already on file, already suggested, at a
 * company they turned down or in an industry they excluded. Dash then
 * chooses among them. Pure, so the rule is tested without fetching.
 */

export type BoardPosting = {
  company: string;
  industry: string | null;
  title: string;
  url: string;
  location: string | null;
};

/** How many candidates the search reads, so a big board cannot crowd the prompt. */
export const BOARD_CANDIDATE_LIMIT = 40;

export function pickBoardCandidates(
  postings: readonly BoardPosting[],
  rules: {
    targetTitles: readonly string[];
    /** Titles of roles saved or answered by a person: what has worked. */
    likedTitles: readonly string[];
    taken: { urls: ReadonlySet<string>; roles: ReadonlySet<string>; companies?: ReadonlySet<string> };
    /** `exclusionWords` of the excluded industries. */
    excludedWords: readonly string[];
  },
): BoardPosting[] {
  const targets = rules.targetTitles.filter(Boolean);
  const liked = rules.likedTitles.filter(Boolean);
  if (targets.length === 0 && liked.length === 0) return [];

  const seen = new Set<string>();
  const ranked: { posting: BoardPosting; rank: number }[] = [];
  for (const posting of postings) {
    if (rules.taken.urls.has(posting.url)) continue;
    const key = roleKey(posting.company, posting.title);
    if (rules.taken.roles.has(key) || seen.has(key)) continue;
    if (rules.taken.companies?.has(companyKey(posting.company))) continue;
    if (isExcluded(rules.excludedWords, posting.industry, posting.company, posting.title)) continue;
    const onTarget = targets.some((t) => isSimilarTitle(posting.title, t));
    const likeLiked = !onTarget && liked.some((t) => isSimilarTitle(posting.title, t));
    if (!onTarget && !likeLiked) continue;
    seen.add(key);
    ranked.push({ posting, rank: onTarget ? 0 : 1 });
  }
  return ranked
    .sort((a, b) => a.rank - b.rank)
    .slice(0, BOARD_CANDIDATE_LIMIT)
    .map((entry) => entry.posting);
}

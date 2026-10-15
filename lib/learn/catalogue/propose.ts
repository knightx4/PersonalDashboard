import { MAX_TITLES } from './pull';

/**
 * Proposing a subject's Wikipedia articles from the names of its ideas
 * (plan #2157.1). Each name is looked up with Wikipedia's own search and the
 * top hit is proposed; no model is asked. Repeats and articles the catalogue
 * already holds are left out, so what comes back is what pulling would add.
 */

export type Proposal = {
  /** The article's title, as Wikipedia gives it. */
  title: string;
  /** The first idea whose name led to it. */
  idea: string;
};

export type ProposeReport = {
  proposals: Proposal[];
  /** Ideas Wikipedia found no article for. */
  unmatched: number;
  /** Ideas whose article another idea had already led to. */
  duplicates: number;
  /** Articles found that the catalogue already holds. */
  inCatalogue: number;
  /** Proposals dropped to stay within one press's limit. */
  overLimit: number;
  /** Set when Wikipedia stopped answering; what was found before is kept. */
  stopped: string | null;
};

export type ProposePorts = {
  search(name: string): Promise<{ ok: true; title: string | null } | { ok: false; detail: string }>;
  /** Which of these titles are already stored. */
  held(titles: string[]): Promise<Set<string>>;
};

export const articleKey = (title: string) => title.trim().replace(/_/g, ' ').toLowerCase();

export async function proposeArticles(ports: ProposePorts, ideaNames: string[]): Promise<ProposeReport> {
  const seen = new Set<string>();
  const found: Proposal[] = [];
  let unmatched = 0;
  let duplicates = 0;
  let stopped: string | null = null;

  const names = [...new Set(ideaNames.map((name) => name.trim()).filter(Boolean))];
  for (const idea of names) {
    const result = await ports.search(idea);
    if (!result.ok) {
      stopped = result.detail;
      break;
    }
    if (!result.title) {
      unmatched += 1;
      continue;
    }
    const key = articleKey(result.title);
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    found.push({ title: result.title, idea });
  }

  const held = found.length > 0 ? await ports.held(found.map((p) => p.title)) : new Set<string>();
  const heldKeys = new Set([...held].map(articleKey));
  const fresh = found.filter((p) => !heldKeys.has(articleKey(p.title)));
  const proposals = fresh.slice(0, MAX_TITLES);

  return {
    proposals,
    unmatched,
    duplicates,
    inCatalogue: found.length - fresh.length,
    overLimit: fresh.length - proposals.length,
    stopped,
  };
}

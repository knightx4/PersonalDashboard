/**
 * Research on an essay, when you ask (plan #1863.9; docs/LEARN-ESSAYS-SPEC.md,
 * "Research, when you ask").
 *
 * Two levels, each a button with its price on it:
 *
 * - **First pass.** Up to four web searches on the essay's question and on
 *   what would change the writer's mind, and three to five positions people
 *   take on it, each with the pages it came from.
 * - **Deeper pass.** Up to eight searches and five pages read in full, then
 *   each of the draft's main claims marked supported, opposed or mixed by
 *   what those pages say, with the quoted words.
 *
 * Nothing is cited unless it was retrieved. Every quote here is the
 * `cited_text` of a citation the API returned (a web search result location
 * on the first pass, a character range in a fetched page on the deeper one),
 * never text the model wrote about a source. A position or a claim's support
 * with no such citation is dropped, not shown bare.
 *
 * The parsers read the response's content blocks as plain JSON, since the
 * installed SDK predates the web tools' types, and nothing here touches the
 * database or the network, so it is tested from fixtures.
 */

export type ResearchLevel = 'first' | 'deeper';

export const RESEARCH_LEVELS: readonly ResearchLevel[] = ['first', 'deeper'];

/** The caps the spec sets, passed to the tools as `max_uses`. */
export const FIRST_PASS_SEARCHES = 4;
export const DEEPER_SEARCHES = 8;
export const DEEPER_PAGES = 5;

/** How many positions a first pass keeps, and claims a deeper one. */
export const POSITIONS_MAX = 5;
export const CLAIMS_MAX = 6;

/** The text kept of a page the deeper pass read, enough to find any quote in it again. */
export const KEPT_CHARS = 20_000;

/** The deeper pass reads a draft up to about this long, the same bound the checks use. */
export const RESEARCH_DRAFT_MAX = 24_000;

export type ResearchSource = {
  url: string;
  title: string;
  domain: string;
  /** The page's text as read, for a page the deeper pass fetched; null for a search result. */
  text: string | null;
};

export type Stance = 'for' | 'against';

export type ResearchCitation = {
  /** Index into the run's sources. */
  source: number;
  /** The words the API's citation quotes, as it gave them. */
  quote: string;
  /** On a deeper pass, whether the passage supports or opposes the claim. */
  stance?: Stance;
};

export type ResearchPosition = { title: string; summary: string; citations: ResearchCitation[] };

export type ClaimVerdict = 'supported' | 'opposed' | 'mixed' | 'unsourced';

export type ResearchClaim = {
  claim: string;
  verdict: ClaimVerdict;
  /** Distinct sources quoted for and against. Counted, not weighed. */
  supporting: number;
  opposing: number;
  citations: ResearchCitation[];
};

/** One run as the page shows it. */
export type EssayResearch = {
  id: string;
  level: ResearchLevel;
  question: string;
  queries: string[];
  sources: ResearchSource[];
  positions: ResearchPosition[];
  claims: ResearchClaim[];
  costMicros: number | null;
  createdAt: string;
};

/** The newest run of each level, which is what the card shows. */
export type EssayResearchRuns = { first: EssayResearch | null; deeper: EssayResearch | null };

export const NO_RESEARCH: EssayResearchRuns = { first: null, deeper: null };

// ---------------------------------------------------------------------------
// What is sent
// ---------------------------------------------------------------------------

/**
 * What the first pass searches with: the brief's question and what would
 * change the writer's mind, and nothing else. The draft, the origin answer
 * and anything from the vault stay out of it, so no note of theirs can end up
 * in a search query.
 */
export function firstPassBasis(brief: { question: string; change: string }): string | null {
  const question = brief.question.trim();
  if (!question) return null;
  const change = brief.change.trim();
  return change
    ? `The essay's question: ${question}\n\nWhat would change the writer's mind: ${change}`
    : `The essay's question: ${question}`;
}

export const FIRST_PASS_SYSTEM = `You are Dash, researching a question for someone who is writing an essay
themselves. You do not write the essay and you do not give your own view.

Search the web for the question you are given. You have at most ${FIRST_PASS_SEARCHES} searches;
write each one in general terms about the subject. Then report the 3 to ${POSITIONS_MAX} main
positions people take on the question, the ones that disagree with each other
first. If you find the position the writer says would change their mind,
include it.

Write each position as a line that starts with "## " and states the position
in one sentence. Under it write two or three sentences on who holds it and
why, each one drawn from a search result so that it carries a citation.

NEVER
- Write a preamble, a conclusion or a summary of your own.
- State anything a search result did not say.
- Report a position you found no source for.`;

export const GATHER_SYSTEM = `You are gathering sources to check the claims in an essay draft. Someone
else will judge the claims; your job is only to find and read the pages.

Find pages that bear on the draft's main claims of fact and argument, for or
against them. You have at most ${DEEPER_SEARCHES} searches and may read at most ${DEEPER_PAGES} pages in
full with web_fetch. Write every search in general terms about the subject:
never paste a sentence of the draft into a search. Read the ${DEEPER_PAGES} pages most
likely to settle the draft's main claims, preferring primary sources and
pages that disagree with the draft.

When you have read them, reply with the single word: Done.`;

export const JUDGE_SYSTEM = `You are Dash, checking the claims in someone's essay draft against pages
retrieved from the web, which are attached as documents. You do not judge the
claims yourself and you do not rewrite the essay: you report what the pages
say about each claim, quoting them.

Pick the draft's main claims, at most ${CLAIMS_MAX}, in the order the draft makes them.
For each one write:

## <the claim, in one short sentence>
For: <one sentence saying what a page says that supports it>
Against: <one sentence saying what a page says that opposes it>

Repeat For or Against once for each page that speaks to the claim, and leave
either out when no page does. Every For and Against sentence must cite the
passage it rests on. If no page speaks to a claim, write its heading alone.

Write nothing else: no preamble, no verdicts, no summary.`;

export function gatherPrompt(question: string, draft: string): string {
  return `The essay's question: ${question.trim() || 'not written yet'}\n\nThe draft:\n<draft>\n${draft.trim()}\n</draft>`;
}

/** Why a deeper pass cannot run on this draft yet, or null when it can. */
export function deeperProblem(draft: string): string | null {
  const words = draft.trim().split(/\s+/).filter(Boolean).length;
  if (words < 60) return 'Write a paragraph or two first; the deeper pass checks the claims your draft makes.';
  if (draft.length > RESEARCH_DRAFT_MAX) return 'The deeper pass reads essays up to about 4,000 words. This one is longer.';
  return null;
}

// ---------------------------------------------------------------------------
// Reading what came back
// ---------------------------------------------------------------------------

type Block = Record<string, unknown>;

function blocks(content: unknown): Block[] {
  return Array.isArray(content)
    ? content.filter((b): b is Block => typeof b === 'object' && b !== null)
    : [];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** A page's address without its fragment, which is how two citations of one page are matched. */
export function pageUrl(url: string): string {
  const hash = url.indexOf('#');
  return hash < 0 ? url : url.slice(0, hash);
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The searches a response ran, in order. */
export function searchQueries(content: unknown): string[] {
  const queries: string[] = [];
  for (const block of blocks(content)) {
    if (block.type !== 'server_tool_use' || block.name !== 'web_search') continue;
    const query = oneLine(str((block.input as Block | undefined)?.query));
    if (query && !queries.includes(query)) queries.push(query);
  }
  return queries;
}

/** The sources a run cites, one per page, built up as the citations are read. */
class SourceList {
  readonly sources: ResearchSource[] = [];
  private readonly byUrl = new Map<string, number>();

  add(url: string, title: string, text: string | null = null): number {
    const key = pageUrl(url);
    const known = this.byUrl.get(key);
    if (known !== undefined) {
      if (text && !this.sources[known].text) this.sources[known].text = text;
      return known;
    }
    const index = this.sources.length;
    this.sources.push({ url: key, title: oneLine(title) || domainOf(key) || key, domain: domainOf(key), text });
    this.byUrl.set(key, index);
    return index;
  }
}

function addCitation(list: ResearchCitation[], citation: ResearchCitation): void {
  const quote = citation.quote.trim();
  if (!quote) return;
  if (list.some((c) => c.source === citation.source && c.quote === quote && c.stance === citation.stance)) return;
  list.push({ ...citation, quote });
}

/** Lines of a text block that open a new heading, and what each says. */
function headingIn(line: string): string | null {
  const match = /^\s*#{2,3}\s+(.+?)\s*$/.exec(line);
  if (!match) return null;
  return match[1].replace(/^(position|claim)\s*\d*\s*[:.-]\s*/i, '').replace(/\*\*/g, '').trim() || null;
}

/**
 * A first pass's positions, from the text blocks after the searches: each
 * `## ` line starts a position, the sentences under it are its summary, and
 * the web search citations on those sentences are its sources.
 */
export function readFirstPass(content: unknown): {
  positions: ResearchPosition[];
  sources: ResearchSource[];
  queries: string[];
} {
  const list = new SourceList();
  const positions: ResearchPosition[] = [];
  let current: ResearchPosition | null = null;

  for (const block of blocks(content)) {
    if (block.type !== 'text') continue;
    for (const line of str(block.text).split('\n')) {
      const heading = headingIn(line);
      if (heading) {
        current = { title: heading, summary: '', citations: [] };
        positions.push(current);
      } else if (current) {
        current.summary += `${line}\n`;
      }
    }
    if (!current) continue;
    for (const raw of blocks(block.citations)) {
      if (raw.type !== 'web_search_result_location') continue;
      const url = str(raw.url);
      if (!isWebUrl(url)) continue;
      addCitation(current.citations, { source: list.add(url, str(raw.title)), quote: str(raw.cited_text) });
    }
  }

  const kept = positions
    .map((p) => ({ ...p, summary: oneLine(p.summary.replace(/^\s*[-*]\s+/gm, '')) }))
    .filter((p) => p.citations.length > 0)
    .slice(0, POSITIONS_MAX);
  return compact(kept, list.sources, searchQueries(content), (p) => p.citations, (p, citations) => ({ ...p, citations }));
}

/** The pages a gathering call read with web_fetch, with their text kept. */
export function readFetchedPages(content: unknown): ResearchSource[] {
  const list = new SourceList();
  for (const block of blocks(content)) {
    if (block.type !== 'web_fetch_tool_result') continue;
    const result = block.content as Block | undefined;
    if (!result || result.type !== 'web_fetch_result') continue;
    const doc = result.content as Block | undefined;
    const source = doc?.source as Block | undefined;
    const url = str(result.url);
    if (!doc || source?.type !== 'text' || !isWebUrl(url)) continue;
    const text = str(source.data).trim();
    if (text.length < 200) continue;
    list.add(url, str(doc.title), text.slice(0, KEPT_CHARS));
  }
  return list.sources;
}

/**
 * A deeper pass's claims, from the judge's text: each `## ` line is a claim,
 * a line starting "For:" or "Against:" sets the stance of the citations that
 * follow it, and each citation's document index is the page it quotes.
 */
export function readClaims(content: unknown, pages: readonly ResearchSource[]): ResearchClaim[] {
  const claims: { claim: string; citations: ResearchCitation[] }[] = [];
  let current: (typeof claims)[number] | null = null;
  let stance: Stance | null = null;

  for (const block of blocks(content)) {
    if (block.type !== 'text') continue;
    for (const line of str(block.text).split('\n')) {
      const heading = headingIn(line);
      if (heading) {
        current = { claim: heading, citations: [] };
        claims.push(current);
        stance = null;
        continue;
      }
      const marker = /(?:^|\s)(For|Against)\s*:/i.exec(line);
      if (marker) stance = marker[1].toLowerCase() === 'for' ? 'for' : 'against';
    }
    if (!current || !stance) continue;
    for (const raw of blocks(block.citations)) {
      if (raw.type !== 'char_location') continue;
      const index = typeof raw.document_index === 'number' ? raw.document_index : -1;
      if (!pages[index]) continue;
      addCitation(current.citations, { source: index, quote: str(raw.cited_text), stance });
    }
  }

  return claims.slice(0, CLAIMS_MAX).map(({ claim, citations }) => ({ claim, citations, ...tally(citations) }));
}

/** How many distinct sources are quoted for and against, and the verdict that follows. */
export function tally(citations: readonly ResearchCitation[]): Pick<ResearchClaim, 'verdict' | 'supporting' | 'opposing'> {
  const supporting = new Set(citations.filter((c) => c.stance === 'for').map((c) => c.source)).size;
  const opposing = new Set(citations.filter((c) => c.stance === 'against').map((c) => c.source)).size;
  const verdict: ClaimVerdict =
    supporting > 0 && opposing > 0 ? 'mixed' : supporting > 0 ? 'supported' : opposing > 0 ? 'opposed' : 'unsourced';
  return { verdict, supporting, opposing };
}

/** Keep only the sources something cites, renumbering the citations to match. */
function compact<T>(
  items: T[],
  sources: ResearchSource[],
  queries: string[],
  citationsOf: (item: T) => ResearchCitation[],
  withCitations: (item: T, citations: ResearchCitation[]) => T,
): { positions: T[]; sources: ResearchSource[]; queries: string[] } {
  const used = [...new Set(items.flatMap((item) => citationsOf(item).map((c) => c.source)))].sort((a, b) => a - b);
  const renumber = new Map(used.map((old, i) => [old, i]));
  return {
    positions: items.map((item) =>
      withCitations(
        item,
        citationsOf(item).map((c) => ({ ...c, source: renumber.get(c.source)! })),
      ),
    ),
    sources: used.map((i) => sources[i]),
    queries,
  };
}

/** The deeper pass's sources trimmed to the pages a claim quotes, and the claims renumbered. */
export function citedPages(
  claims: ResearchClaim[],
  pages: ResearchSource[],
): { claims: ResearchClaim[]; sources: ResearchSource[] } {
  const out = compact(claims, pages, [], (c) => c.citations, (c, citations) => ({ ...c, citations }));
  return { claims: out.positions, sources: out.sources };
}

/** "2 sources support it, 1 opposes it": a count, and the card says it is not a weighing. */
export function countLine(claim: Pick<ResearchClaim, 'supporting' | 'opposing'>): string {
  const part = (n: number, one: string, many: string) => `${n} ${n === 1 ? 'source' : 'sources'} ${n === 1 ? one : many}`;
  const parts = [
    claim.supporting > 0 ? part(claim.supporting, 'supports it', 'support it') : null,
    claim.opposing > 0 ? part(claim.opposing, 'opposes it', 'oppose it') : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'No page Dash read speaks to it';
}

export const VERDICT_LABELS: Record<ClaimVerdict, string> = {
  supported: 'Supported',
  opposed: 'Opposed',
  mixed: 'Mixed',
  unsourced: 'Not found',
};

// ---------------------------------------------------------------------------
// The footnote a source becomes
// ---------------------------------------------------------------------------

/** Characters a text fragment's terms must have escaped beyond encodeURIComponent's. */
function fragmentTerm(text: string): string {
  return encodeURIComponent(text).replace(/-/g, '%2D').replace(/,/g, '%2C').replace(/&/g, '%26');
}

/**
 * The page's address with a text fragment that scrolls it to the quoted words
 * (`#:~:text=start,end`). A long quote is matched by its first and last four
 * words, so a difference in the middle, such as a link or a line break the
 * citation flattened, does not stop it matching. A quote the API cut short
 * ("...") loses its last, partial word.
 */
export function textFragmentUrl(url: string, quote: string): string {
  let text = quote.replace(/\s+/g, ' ').trim();
  const cut = /(\.\.\.|…)$/.test(text);
  text = text.replace(/(\.\.\.|…)$/, '').trim();
  let words = text
    .split(' ')
    .map((word) => word.replace(/^[[("'“‘*_#>|]+|[\])"'”’*_|]+$/g, ''))
    .filter(Boolean);
  if (cut && words.length > 1) words = words.slice(0, -1);
  if (words.length === 0) return pageUrl(url);
  const term =
    words.length <= 8
      ? fragmentTerm(words.join(' '))
      : `${fragmentTerm(words.slice(0, 4).join(' '))},${fragmentTerm(words.slice(-4).join(' '))}`;
  return `${pageUrl(url)}#:~:text=${term}`;
}

const DEFINITION = /^\[\^([^\]\s]+)\]:\s*\[[^\]]*\]\((\S+?)\)/gm;
const REFERENCE = /\[\^(\d+)\]/g;

/**
 * The footnote for a source, numbered by first use and one per source
 * (spec, "Research, when you ask"): the reference to put at the cursor, and
 * the definition to add at the end of the essay, or null when the essay
 * already has a footnote for that page, whose number is then reused.
 */
export function footnoteFor(
  doc: string,
  source: Pick<ResearchSource, 'url' | 'title' | 'domain'>,
  quote: string,
): { ref: string; definition: string | null } {
  const page = pageUrl(source.url);
  let highest = 0;
  for (const match of doc.matchAll(DEFINITION)) {
    if (pageUrl(match[2]) === page) return { ref: `[^${match[1]}]`, definition: null };
  }
  for (const match of doc.matchAll(REFERENCE)) highest = Math.max(highest, Number(match[1]));
  const n = highest + 1;
  const title = oneLine(source.title).replace(/[[\]]/g, '') || source.domain || page;
  const link = textFragmentUrl(page, quote).replace(/\(/g, '%28').replace(/\)/g, '%29');
  const tail = source.domain ? ` · ${source.domain}` : '';
  return { ref: `[^${n}]`, definition: `[^${n}]: [${title}](${link})${tail}` };
}

/** Where a footnote definition goes: after the essay, a blank line before the first one. */
export function definitionInsert(doc: string, definition: string): string {
  const trimmed = doc.replace(/\s+$/, '');
  const lastLine = trimmed.slice(trimmed.lastIndexOf('\n') + 1);
  if (trimmed === '') return `${definition}\n`;
  // Inserted at the very end, so the newlines already there count towards the gap.
  const want = /^\[\^[^\]]+\]:/.test(lastLine) ? 1 : 2;
  const have = (doc.slice(trimmed.length).match(/\n/g) ?? []).length;
  return `${'\n'.repeat(Math.max(0, want - have))}${definition}\n`;
}

// ---------------------------------------------------------------------------
// The stored row
// ---------------------------------------------------------------------------

export type ResearchRow = {
  id: string;
  level: string;
  question: string;
  queries: string[] | null;
  sources: unknown;
  findings: unknown;
  cost_micros: number | string | null;
  created_at: string;
};

function readSources(raw: unknown): ResearchSource[] {
  return blocks(raw).flatMap((s) => {
    const url = str(s.url);
    if (!isWebUrl(url)) return [];
    return [{ url, title: str(s.title) || domainOf(url), domain: str(s.domain) || domainOf(url), text: typeof s.text === 'string' ? s.text : null }];
  });
}

function readCitations(raw: unknown, sources: number): ResearchCitation[] {
  return blocks(raw).flatMap((c) => {
    const source = typeof c.source === 'number' ? c.source : -1;
    const quote = str(c.quote).trim();
    if (source < 0 || source >= sources || !quote) return [];
    const stance = c.stance === 'for' || c.stance === 'against' ? c.stance : undefined;
    return [{ source, quote, ...(stance ? { stance } : {}) }];
  });
}

export function researchFromRow(row: ResearchRow): EssayResearch | null {
  if (row.level !== 'first' && row.level !== 'deeper') return null;
  const sources = readSources(row.sources);
  const findings = blocks(row.findings);
  const positions =
    row.level === 'first'
      ? findings.map((f) => ({
          title: str(f.title),
          summary: str(f.summary),
          citations: readCitations(f.citations, sources.length),
        }))
      : [];
  const claims =
    row.level === 'deeper'
      ? findings.map((f) => {
          const citations = readCitations(f.citations, sources.length);
          return { claim: str(f.claim), citations, ...tally(citations) };
        })
      : [];
  const cost = row.cost_micros === null ? null : Number(row.cost_micros);
  return {
    id: row.id,
    level: row.level,
    question: row.question,
    queries: row.queries ?? [],
    sources,
    positions,
    claims,
    costMicros: cost !== null && Number.isFinite(cost) ? cost : null,
    createdAt: row.created_at,
  };
}

/** What the card needs of a source: the page and its text are kept in the row, not sent to the browser. */
export function forBrowser(run: EssayResearch): EssayResearch {
  return { ...run, sources: run.sources.map((s) => ({ ...s, text: null })) };
}

/**
 * The essay's research, written up for the writer (docs/LEARN-ESSAYS-SPEC.md,
 * "Research, when you ask").
 *
 * One Sonnet call with web search. It is told the question, the writer's
 * answer so far, their reader and what would change their mind, and that they
 * already know their field. It searches for what they do not have yet and
 * writes five sections: where the debate stands, what supports their answer,
 * what pushes back, specific material they could use, and questions asking
 * where they stand. Every item outside the questions is built from search
 * results, so it carries the API's own citations.
 *
 * The first version (15 October 2026) framed sub-questions, read five pages
 * and wrote only from those. In practice it read three pages on one
 * announcement, explained the basics of the writer's own field to them, and
 * answered most parts with "the pages do not say". Searching broadly and
 * citing the search results directly fixes the coverage; telling the call
 * what the writer thinks fixes the aim.
 *
 * Nothing is cited unless it was retrieved: an item with no citation is
 * dropped. The writer's words go to the model as context and are never pasted
 * into a search; nothing from the vault is sent.
 *
 * Nothing here touches the database or the network.
 */

import {
  addCitation,
  isWebUrl,
  SourceList,
  type FindingKind,
  type ResearchCitation,
  type ResearchPosition,
  type ResearchSource,
} from './research';

/** The most searches one run may make. */
export const MAP_SEARCHES = 8;
export const ASKS_MAX = 3;
/** Items kept in each of the three lists. */
export const ITEMS_MAX = 4;

export const MAP_SYSTEM = `You are Dash, researching for someone who is about to write a short essay of
their own. They know their field: their answer below shows what they already
know, so never explain the basics of it to them. Your job is to find what they
do not have yet: evidence for their answer, evidence against it, and specific
material they could put in the essay. You do not write any of their essay.

Search the web, at most ${MAP_SEARCHES} times. Write every search in general terms about
the subject; never paste their words into a search. Prefer regulators and
standard-setters, research, professional bodies, and practitioners writing
from experience; use a vendor only when nothing better says the same. Cite the
primary document itself (the standard, the regulation, the study) rather than
an article about it whenever the search finds it, and check that guidance you
cite is still in force: if it has been rescinded, superseded or deferred, say
so. Look on purpose for the strongest case against their answer, and for
whatever they said would change their mind.

Where a sentence names a document, report, rule or study that a search
result is, or links to, make the words that name it a markdown link to that
address exactly as the result gives it: "it released [guidance](https://...)".
Link only addresses that appear in the results; never make one up.

Then write exactly these five sections, in this order, with these headings.
Every sentence outside "Questions for you" must rest on a search result, so
that it carries a citation. Leave out anything you cannot source; an empty
section is better than an unsourced one.

## Where the debate stands
Three or four short sentences: what people who know the subject agree on,
and where they split.

## Supports your answer
## Pushes back
## You could use
Under each, two to ${ITEMS_MAX} items. Each item is one line starting "- " with a short
headline of under twelve words in bold, a colon, then one or two sentences
giving the specific fact, finding, case, figure or framework and who says it.
"You could use" is for concrete things to put in the essay: a named
framework, a statistic, a real case, a line worth quoting.

## Questions for you
Two or three lines starting "- ", each one question asking where the writer
stands on something specific you found.

Plain English and short sentences. No preamble and no closing summary.`;

/**
 * What the call is told: the question, the writer's answer so far, their
 * reader and what would change their mind. Null without a question. The
 * origin answer is left out, since it often quotes the vault.
 */
export function mapPrompt(brief: {
  question: string;
  claim: string;
  reader: string;
  change: string;
}): string | null {
  const question = brief.question.trim();
  if (!question) return null;
  const lines = [`The essay's question: ${question}`];
  if (brief.claim.trim())
    lines.push('', `Their answer so far, in their words:\n${brief.claim.trim()}`);
  if (brief.reader.trim()) lines.push('', `Who it is for: ${brief.reader.trim()}`);
  if (brief.change.trim()) lines.push('', `What would change their mind: ${brief.change.trim()}`);
  return lines.join('\n');
}

type Block = Record<string, unknown>;

function blocks(content: unknown): Block[] {
  return Array.isArray(content)
    ? content.filter((b): b is Block => typeof b === 'object' && b !== null)
    : [];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

type Section = FindingKind | 'questions';

function sectionOf(heading: string): Section | null {
  const h = heading.toLowerCase();
  if (h.includes('debate')) return 'debate';
  if (h.includes('support')) return 'for';
  if (h.includes('push') || h.includes('against')) return 'against';
  if (h.includes('could use') || h.includes('use')) return 'use';
  if (h.includes('question')) return 'questions';
  return null;
}

/** "**Headline**: the rest" as its headline and the rest. */
export function splitItem(text: string): { title: string; summary: string } {
  const line = oneLine(text);
  const bold = /^\*\*(.+?)\*\*\s*[:.–—-]?\s*(.*)$/.exec(line);
  if (bold) return { title: bold[1]!.replace(/[:.]$/, '').trim(), summary: bold[2]!.trim() };
  const colon = line.indexOf(': ');
  if (colon > 0 && colon <= 90)
    return { title: line.slice(0, colon).trim(), summary: line.slice(colon + 2).trim() };
  return { title: '', summary: line };
}

export type ResearchMap = {
  /** The debate as one finding, then the items for, against and to use, each with its citations. */
  findings: ResearchPosition[];
  /** The debate's text, shown first. */
  summary: string;
  asks: string[];
  sources: ResearchSource[];
};

/**
 * The write-up from the reply. Headings set the section; in the three lists a
 * line starting "- " opens an item; the web search citations on each text
 * block go to the item (or the debate) the block's text belongs to. Items with
 * no citation are dropped, and the sources are only the pages something cites.
 */
export function readMap(content: unknown): ResearchMap {
  const list = new SourceList();
  type Open = { kind: FindingKind; text: string; citations: ResearchCitation[] };
  const debate: Open = { kind: 'debate', text: '', citations: [] };
  const items: Open[] = [];
  const asks: string[] = [];
  let section: Section | null = null;
  let current: Open | null = null;
  let atLineStart = true;

  for (const block of blocks(content)) {
    if (block.type !== 'text') continue;
    const text = str(block.text);
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      const startsLine = i > 0 || atLineStart;
      const heading = startsLine ? /^\s*#{1,3}\s+(.+?)\s*$/.exec(line) : null;
      if (heading) {
        section = sectionOf(heading[1]!.replace(/\*\*/g, ''));
        current = section === 'debate' ? debate : null;
        return;
      }
      if (section === 'questions') {
        const ask = startsLine
          ? /^\s*(?:[-*]|\d+[.)])\s+(.+?)\s*$/.exec(line)?.[1]?.replace(/\*\*/g, '').trim()
          : null;
        if (
          ask &&
          ask.endsWith('?') &&
          ask.length <= 300 &&
          !asks.includes(ask) &&
          asks.length < ASKS_MAX
        )
          asks.push(ask);
        return;
      }
      if (section === 'for' || section === 'against' || section === 'use') {
        const item = startsLine ? /^\s*[-*]\s+(.*)$/.exec(line) : null;
        if (item) {
          current = { kind: section, text: item[1]!, citations: [] };
          items.push(current);
          return;
        }
      }
      if (current) current.text += (startsLine && i > 0 ? ' ' : '') + line;
    });
    atLineStart = text.endsWith('\n');
    const target = current as Open | null;
    if (!target) continue;
    for (const raw of blocks(block.citations)) {
      if (raw.type !== 'web_search_result_location') continue;
      const url = str(raw.url);
      if (!isWebUrl(url)) continue;
      addCitation(target.citations, {
        source: list.add(url, str(raw.title)),
        quote: str(raw.cited_text),
      });
    }
  }

  const kept: ResearchPosition[] = [];
  if (debate.citations.length > 0 && oneLine(debate.text)) {
    kept.push({
      kind: 'debate',
      title: '',
      summary: oneLine(debate.text),
      citations: debate.citations,
    });
  }
  const counts: Record<string, number> = {};
  for (const item of items) {
    if (item.citations.length === 0) continue;
    counts[item.kind] = (counts[item.kind] ?? 0) + 1;
    if (counts[item.kind]! > ITEMS_MAX) continue;
    const { title, summary } = splitItem(item.text);
    if (!summary && !title) continue;
    kept.push({ kind: item.kind, title, summary, citations: item.citations });
  }

  // Only the pages something cites, renumbered to match.
  const used = [...new Set(kept.flatMap((f) => f.citations.map((c) => c.source)))].sort(
    (a, b) => a - b,
  );
  const renumber = new Map(used.map((old, i) => [old, i]));
  return {
    findings: kept.map((f) => ({
      ...f,
      summary: keepPageLinks(f.summary, list.sources),
      citations: f.citations.map((c) => ({ ...c, source: renumber.get(c.source)! })),
    })),
    summary: kept[0]?.kind === 'debate' ? keepPageLinks(kept[0].summary, list.sources) : '',
    asks,
    sources: used.map((i) => list.sources[i]!),
  };
}

const MARKDOWN_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;

/**
 * The write-up's links, kept only where the address is one of the pages read
 * or appears in one of them (note 179b2256). Any other is a guessed address,
 * and its words stay as plain text.
 */
export function keepPageLinks(text: string, pages: readonly ResearchSource[]): string {
  const bare = (url: string) => url.replace(/\/$/, '');
  const known = (url: string) =>
    pages.some((page) => bare(page.url) === bare(url) || (page.text ?? '').includes(url));
  return text.replace(MARKDOWN_LINK, (whole, words: string, url: string) =>
    known(url) ? whole : words,
  );
}

/** The key a take on one finding of a run is kept under: the run, and the finding or the question. */
export function takeKey(runId: string, part: { part: number } | { ask: number }): string {
  return 'part' in part ? `${runId}:p${part.part}` : `${runId}:q${part.ask}`;
}

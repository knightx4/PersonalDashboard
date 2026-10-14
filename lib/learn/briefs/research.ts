/**
 * Researching a brief's question on the web (plan #2023.2; feature #2023,
 * "Research a topic when you ask Dash").
 *
 * Three calls, the essay research's way (lib/learn/essays/research.ts):
 *
 * 1. **Frame.** The question and why the person wants it become three to
 *    five sub-questions.
 * 2. **Search and read.** Haiku with web search (two a sub-question, at most
 *    ten) and web fetch (at most five pages), preferring regulators and
 *    standard-setters, then professional bodies, firms and the press, and
 *    labelling vendor pages. It ends by listing the sources worth keeping,
 *    each with its kind, a why line and a summary.
 * 3. **Write.** Sonnet reads the fetched pages as documents with citations
 *    on and writes a position for each sub-question and a short answer from
 *    the person's angle.
 *
 * The essay rule holds: every quote is the `cited_text` of a citation the API
 * returned, located in a page that was fetched, and a position with no such
 * citation is dropped. A listed source has to be one the run actually
 * retrieved, so no address the model wrote from memory reaches the list.
 *
 * This file has the prompts and reads what comes back; research-model.ts
 * makes the calls and research-run.ts writes the brief. Nothing here touches
 * the database or the network, so it is tested from fixtures.
 */

import { domainOf, pageUrl, type ResearchSource } from '@/lib/learn/essays/research';
import { readFoundKind, type BriefDepth, type FoundKind, type SubQuestion } from './model';

export const SUB_QUESTIONS_MIN = 3;
export const SUB_QUESTIONS_MAX = 5;
/** The most readings one brief puts on its list, and the fewest it aims for. */
export const READINGS_MAX = 12;
export const READINGS_AIM = 6;
/** About how long the short answer is, in words. */
export const SHORT_ANSWER_WORDS = 150;

/** How much one run may search and read, by the brief's depth. */
export function researchBudget(depth: BriefDepth, subQuestions: number): { searches: number; pages: number } {
  const n = Math.max(1, subQuestions);
  if (depth === 'quick') return { searches: Math.min(5, n), pages: 3 };
  if (depth === 'deep') return { searches: 10, pages: 5 };
  return { searches: Math.min(10, 2 * n), pages: 5 };
}

// ---------------------------------------------------------------------------
// 1. Frame
// ---------------------------------------------------------------------------

export const FRAME_SYSTEM = `You are Dash, about to research a question for someone who wants to learn
about it. Break their question into ${SUB_QUESTIONS_MIN} to ${SUB_QUESTIONS_MAX} sub-questions that, answered
together, answer it for them.

Write each sub-question so that a web search can answer it: concrete, about
one thing, and in plain words. Order them so the first is what someone new
to the subject needs first. Shape them to why the person wants to know, when
that is given: someone preparing for an interview needs what practitioners
do and argue about, not the history.

Reply with the sub-questions alone, one a line, each starting with its number
and a full stop ("1. "). No preamble and nothing after them.`;

export function framePrompt(question: string, angle: string): string {
  const why = angle.trim();
  return why
    ? `The question: ${question.trim()}\n\nWhy they want to know: ${why}`
    : `The question: ${question.trim()}`;
}

/** The numbered lines of the frame call's reply, as sub-questions q1, q2 and on. */
export function readSubQuestionLines(text: string): SubQuestion[] {
  const out: SubQuestion[] = [];
  for (const line of text.split('\n')) {
    const match = /^\s*(?:\d+[.)]|[-*])\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const body = match[1].replace(/\*\*/g, '').trim();
    if (body.length < 8 || out.some((q) => q.text.toLowerCase() === body.toLowerCase())) continue;
    out.push({ id: `q${out.length + 1}`, text: body.slice(0, 300) });
    if (out.length === SUB_QUESTIONS_MAX) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Search and read
// ---------------------------------------------------------------------------

export function searchSystem(budget: { searches: number; pages: number }): string {
  return `You are gathering sources for a research brief. Someone else writes the
brief from the pages you read; your job is to find and read the right ones.

You have at most ${budget.searches} web searches and may read at most ${budget.pages} pages in full with
web_fetch. Search for each sub-question in turn, about two searches each,
written in general terms about the subject.

Prefer, in this order: regulators and standard-setters (government agencies,
the bodies that write the rules and standards); professional bodies and
institutes; established firms (audit, law, consulting) and serious press.
Vendor pages selling a product come last and are labelled as vendor. Read
in full the ${budget.pages} pages most likely to answer the sub-questions, the most
authoritative first, and no PDF when an HTML page says the same.

When you have finished, list the sources worth keeping, ${READINGS_AIM} to ${READINGS_MAX} of them,
every page you read in full among them, best first. Each takes four lines:

SOURCE: <the page's address, exactly as the search or fetch returned it>
KIND: regulator | professional body | firm | press | vendor
WHY: <one sentence on what it answers for this question>
SUMMARY: <two or three sentences on what the page says>

List only pages your searches or fetches returned. Write nothing else.`;
}

export function searchPrompt(question: string, angle: string, subQuestions: readonly SubQuestion[]): string {
  const lines = subQuestions.map((q, i) => `${i + 1}. ${q.text}`).join('\n');
  return `${framePrompt(question, angle)}\n\nThe sub-questions:\n${lines}`;
}

type Block = Record<string, unknown>;

function blocks(content: unknown): Block[] {
  return Array.isArray(content) ? content.filter((b): b is Block => typeof b === 'object' && b !== null) : [];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** A page the searches returned: its address, title and how old the search said it was. */
export type SearchResult = { url: string; title: string; pageAge: string | null };

/** Every web page the searches returned, once each, in the order they came. */
export function readSearchResults(content: unknown): SearchResult[] {
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  for (const block of blocks(content)) {
    if (block.type !== 'web_search_tool_result') continue;
    for (const result of blocks(block.content)) {
      if (result.type !== 'web_search_result') continue;
      const url = pageUrl(str(result.url));
      if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
      seen.add(url);
      const pageAge = oneLine(str(result.page_age));
      out.push({ url, title: oneLine(str(result.title)) || domainOf(url), pageAge: pageAge || null });
    }
  }
  return out;
}

/** One source as the search call listed it. */
export type ListedSource = { url: string; kind: FoundKind | null; why: string; summary: string };

/** The text the search call ended with, all its text blocks together. */
export function finalText(content: unknown): string {
  return blocks(content)
    .filter((b) => b.type === 'text')
    .map((b) => str(b.text))
    .join('\n');
}

/**
 * The sources the search call listed, in its order: a `SOURCE:` line opens
 * one and `KIND:`, `WHY:` and `SUMMARY:` lines fill it. A summary may run on
 * over several lines.
 */
export function readSourceList(text: string): ListedSource[] {
  const out: ListedSource[] = [];
  let current: ListedSource | null = null;
  let field: 'why' | 'summary' | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\*\*/g, '').trim();
    const match = /^[-*\s]*(SOURCE|KIND|WHY|SUMMARY)\s*:\s*(.*)$/i.exec(line);
    if (match) {
      const key = match[1].toUpperCase();
      const value = match[2].trim();
      if (key === 'SOURCE') {
        const url = /https?:\/\/\S+/i.exec(value)?.[0].replace(/[>),.\]]+$/, '') ?? '';
        current = url ? { url: pageUrl(url), kind: null, why: '', summary: '' } : null;
        if (current) out.push(current);
        field = null;
      } else if (current && key === 'KIND') {
        current.kind = readFoundKind(value);
        field = null;
      } else if (current && key === 'WHY') {
        current.why = value;
        field = 'why';
      } else if (current && key === 'SUMMARY') {
        current.summary = value;
        field = 'summary';
      }
    } else if (current && field && line) {
      current[field] = `${current[field]} ${line}`.trim();
    } else if (!line) {
      field = null;
    }
  }
  return out;
}

/** A guess at a page's kind from its address alone, for a page the list left out. */
export function kindFromDomain(domain: string): FoundKind {
  if (/(^|\.)(gov|mil)(\.[a-z]{2})?$|(^|\.)europa\.eu$|(^|\.)(sec|pcaobus|fasb|ifrs|iasb|fca|bis|iosco|nist|oecd)\.(gov|org|org\.uk|int)$/.test(domain)) {
    return 'regulator';
  }
  return 'press';
}

// ---------------------------------------------------------------------------
// 3. Write
// ---------------------------------------------------------------------------

export const WRITE_SYSTEM = `You are Dash, writing a research brief for someone from pages retrieved
from the web, which are attached as documents. You report what the pages
say; you do not add what you know from elsewhere.

For each sub-question, in order, write a heading line "## Q<number>" and
under it two to four sentences giving the answer the pages support, each
sentence citing the passage it rests on. Where the pages disagree, say so.
If no page speaks to a sub-question, write its heading alone.

Then write a heading line "## Short answer" and under it about ${SHORT_ANSWER_WORDS} words that
answer the whole question for this person, from why they want to know: what
they would say if asked in a conversation or an interview. Plain sentences,
no list.

Write nothing else: no preamble and no closing summary.`;

export function writePrompt(question: string, angle: string, subQuestions: readonly SubQuestion[]): string {
  const lines = subQuestions.map((q, i) => `Q${i + 1}. ${q.text}`).join('\n');
  return `${framePrompt(question, angle)}\n\nThe sub-questions:\n${lines}`;
}

/** A quote located in one of the fetched pages, by the page's index. */
export type PageCitation = { page: number; quote: string };

export type WrittenSection = { subQuestionId: string; position: string; citations: PageCitation[] };

export type WrittenBrief = { sections: WrittenSection[]; shortAnswer: string };

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * The positions and the short answer from the write call's cited reply.
 *
 * A `## Q<n>` line opens sub-question n; `## Short answer` opens the short
 * answer. The text under a heading is its position, and each `char_location`
 * citation on that text is a quote, kept only when it is found in the page it
 * names. A position left with no quote is dropped.
 */
export function readWrittenBrief(
  content: unknown,
  pages: readonly ResearchSource[],
  subQuestions: readonly SubQuestion[],
): WrittenBrief {
  type Open = { kind: 'section'; index: number; text: string; citations: PageCitation[] } | { kind: 'short'; text: string };
  const opened: Open[] = [];
  let current: Open | null = null;
  const pageText = pages.map((p) => squash(p.text ?? ''));

  for (const block of blocks(content)) {
    if (block.type !== 'text') continue;
    for (const line of str(block.text).split('\n')) {
      const heading = /^\s*#{2,3}\s*(.+?)\s*$/.exec(line)?.[1].replace(/\*\*/g, '') ?? null;
      if (heading !== null) {
        const q = /^(?:q|question|sub-question)\s*(\d+)\b/i.exec(heading);
        if (q) {
          current = { kind: 'section', index: Number(q[1]) - 1, text: '', citations: [] };
          opened.push(current);
          continue;
        }
        if (/^short answer\b/i.test(heading)) {
          current = { kind: 'short', text: '' };
          opened.push(current);
          continue;
        }
        current = null;
        continue;
      }
      if (current) current.text += `${line}\n`;
    }
    if (!current || current.kind !== 'section') continue;
    for (const raw of blocks(block.citations)) {
      if (raw.type !== 'char_location') continue;
      const page = typeof raw.document_index === 'number' ? raw.document_index : -1;
      const quote = str(raw.cited_text).trim();
      if (!pages[page] || !quote) continue;
      if (!pageText[page].includes(squash(quote))) continue;
      if (current.citations.some((c) => c.page === page && c.quote === quote)) continue;
      current.citations.push({ page, quote });
    }
  }

  const sections: WrittenSection[] = [];
  for (const open of opened) {
    if (open.kind !== 'section') continue;
    const sub = subQuestions[open.index];
    const position = oneLine(open.text);
    if (!sub || !position || open.citations.length === 0) continue;
    if (sections.some((s) => s.subQuestionId === sub.id)) continue;
    sections.push({ subQuestionId: sub.id, position, citations: open.citations });
  }
  const short = opened.find((o) => o.kind === 'short');
  return { sections, shortAnswer: short ? oneLine(short.text) : '' };
}

// ---------------------------------------------------------------------------
// The reading list
// ---------------------------------------------------------------------------

/** A source going on the brief's reading list. */
export type ChosenReading = {
  url: string;
  title: string;
  kind: FoundKind;
  why: string;
  summary: string | null;
  /** The fetched page's index, when the run read it in full. */
  page: number | null;
};

const WHY_MAX = 300;
const SUMMARY_MAX = 2_000;

/**
 * The readings a run adds, at most twelve: every page a position quotes
 * first, then the rest of what the search call listed in its order. Only
 * pages the run retrieved count, and only https ones, since a reading opens
 * its link. A quoted page the list left out still goes on, with its kind
 * guessed from its address and its why line naming the sub-question.
 */
export function chooseReadings(input: {
  pages: readonly ResearchSource[];
  results: readonly SearchResult[];
  listed: readonly ListedSource[];
  written: WrittenBrief;
  subQuestions: readonly SubQuestion[];
}): ChosenReading[] {
  const pageIndex = new Map(input.pages.map((p, i) => [pageUrl(p.url), i]));
  const resultByUrl = new Map(input.results.map((r) => [r.url, r]));
  const listedByUrl = new Map<string, ListedSource>();
  for (const l of input.listed) if (!listedByUrl.has(l.url)) listedByUrl.set(l.url, l);

  const out: ChosenReading[] = [];
  const taken = new Set<string>();
  const add = (url: string, fallbackWhy: string) => {
    if (taken.has(url) || out.length >= READINGS_MAX || !/^https:\/\//i.test(url)) return;
    const page = pageIndex.get(url);
    const result = resultByUrl.get(url);
    if (page === undefined && !result) return;
    const listed = listedByUrl.get(url);
    const title = (page !== undefined ? input.pages[page].title : '') || result?.title || domainOf(url) || url;
    const why = oneLine(listed?.why ?? '') || fallbackWhy;
    if (!why) return;
    taken.add(url);
    out.push({
      url,
      title: title.slice(0, 500),
      kind: listed?.kind ?? kindFromDomain(domainOf(url)),
      why: why.slice(0, WHY_MAX),
      summary: oneLine(listed?.summary ?? '').slice(0, SUMMARY_MAX) || null,
      page: page ?? null,
    });
  };

  for (const section of input.written.sections) {
    const sub = input.subQuestions.find((q) => q.id === section.subQuestionId);
    for (const c of section.citations) {
      add(pageUrl(input.pages[c.page].url), sub ? `Quoted in the answer to: ${sub.text}` : '');
    }
  }
  for (const l of input.listed) add(l.url, '');
  return out;
}

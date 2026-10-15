/**
 * The essay's research, read as a map of the question (docs/LEARN-ESSAYS-SPEC.md,
 * "Research, when you ask").
 *
 * Three calls, the research brief's way (lib/learn/briefs/research.ts):
 * Sonnet splits the question into what a writer needs to know before arguing
 * it; Haiku searches and reads up to five pages; Sonnet writes, from those
 * pages with citations on, a short version, an answer to each part, and up
 * to three questions asking the writer where they stand. The page shows the
 * short version first and each part as a question with its answer, so it
 * reads top to bottom instead of as a list of quotes.
 *
 * The essay's rules hold. The searches are built from the brief's question
 * and what would change the writer's mind, and nothing else. Every quote is
 * the `cited_text` of a citation the API located in a fetched page, and a
 * part with no such quote is dropped.
 *
 * Nothing here touches the database or the network.
 */

import {
  finalText,
  readWrittenBrief,
  SUB_QUESTIONS_MAX,
  SUB_QUESTIONS_MIN,
} from '@/lib/learn/briefs/research';
import type { SubQuestion } from '@/lib/learn/briefs/model';
import type { ResearchPosition, ResearchSource } from './research';

/** What the essay's research may search and read in one run. */
export const MAP_SEARCHES = 8;
export const MAP_PAGES = 5;
export const ASKS_MAX = 3;
export const SHORT_VERSION_WORDS = 110;

export const MAP_FRAME_SYSTEM = `You are Dash, about to research a question for someone who will write a
short essay answering it themselves. Break the question into ${SUB_QUESTIONS_MIN} to ${SUB_QUESTIONS_MAX}
sub-questions that a writer needs answered before they can argue it well:
what the key terms and facts are, what the main positions are and who holds
them, the strongest case against the answer they lean towards, and the
evidence a careful reader would expect.

Write each sub-question so a web search can answer it: concrete, about one
thing, in plain words. If you are told what would change the writer's mind,
make one sub-question look for exactly that. Order them so someone new to
the subject could read the answers top to bottom.

Reply with the sub-questions alone, one a line, each starting with its number
and a full stop ("1. "). No preamble and nothing after them.`;

/** What the frame and the search read: the question and what would change the writer's mind, and nothing else. */
export function mapBasis(brief: { question: string; change: string }): string | null {
  const question = brief.question.trim();
  if (!question) return null;
  const change = brief.change.trim();
  return change
    ? `The essay's question: ${question}\n\nWhat would change the writer's mind: ${change}`
    : `The essay's question: ${question}`;
}

export function mapSearchPrompt(basis: string, subQuestions: readonly SubQuestion[]): string {
  return `${basis}\n\nThe sub-questions:\n${subQuestions.map((q, i) => `${i + 1}. ${q.text}`).join('\n')}`;
}

export const MAP_WRITE_SYSTEM = `You are Dash, writing up research for someone who is about to write a short
essay of their own. The pages you found are attached as documents. You report
what the pages say; you do not add what you know from elsewhere, and you do
not write any of their essay.

Write for someone reading quickly: short sentences, plain words, every term
explained the first time it appears.

First a heading line "## Short answer" and under it about ${SHORT_VERSION_WORDS} words: the
state of the question as the pages show it, including where they disagree.
Each sentence cites the passage it rests on.

Then, for each sub-question in order, a heading line "## Q<number>" and under
it two to four sentences answering it from the pages, each citing the passage
it rests on. Where the pages disagree, say who says what. If no page speaks
to a sub-question, write its heading alone.

Last, a heading line "## Questions for you" and under it up to ${ASKS_MAX} lines, each
starting "- ", each one question asking the writer where they stand on
something specific the pages said. Questions only, one sentence each.

Write nothing else: no preamble and no closing summary.`;

export function mapWritePrompt(basis: string, subQuestions: readonly SubQuestion[]): string {
  return `${basis}\n\nThe sub-questions:\n${subQuestions.map((q, i) => `Q${i + 1}. ${q.text}`).join('\n')}`;
}

/** The questions the write call ended on, from the lines under "Questions for you". */
export function readAsks(content: unknown): string[] {
  const text = finalText(content);
  const at = text.search(/^\s*#{2,3}\s*questions for you\b/im);
  if (at < 0) return [];
  const out: string[] = [];
  for (const line of text.slice(at).split('\n').slice(1)) {
    if (/^\s*#{1,3}\s/.test(line)) break;
    const ask = /^\s*(?:[-*]|\d+[.)])\s+(.+?)\s*$/.exec(line)?.[1]?.replace(/\*\*/g, '').trim();
    if (!ask || !ask.endsWith('?') || ask.length > 300) continue;
    if (!out.includes(ask)) out.push(ask);
    if (out.length === ASKS_MAX) break;
  }
  return out;
}

export type ResearchMap = {
  /** One part per sub-question that came back with a quote: the sub-question as its title, the answer as its summary. */
  parts: ResearchPosition[];
  summary: string;
  asks: string[];
};

/**
 * The map from the write call's cited reply. The parts' citations index the
 * fetched pages as given, which become the run's sources in that order.
 */
export function readMap(
  content: unknown,
  pages: readonly ResearchSource[],
  subQuestions: readonly SubQuestion[],
): ResearchMap {
  const written = readWrittenBrief(content, pages, subQuestions);
  const parts = written.sections.map((section) => ({
    title: subQuestions.find((q) => q.id === section.subQuestionId)?.text ?? '',
    summary: section.position,
    citations: section.citations.map((c) => ({ source: c.page, quote: c.quote })),
  }));
  return {
    parts: parts.filter((p) => p.title),
    summary: written.shortAnswer,
    asks: readAsks(content),
  };
}

/** The key a take on one part of a run is kept under: the run, and the part or the question. */
export function takeKey(runId: string, part: { part: number } | { ask: number }): string {
  return 'part' in part ? `${runId}:p${part.part}` : `${runId}:q${part.ask}`;
}

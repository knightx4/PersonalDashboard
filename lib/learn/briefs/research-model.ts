import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { readFetchedPages, searchQueries, type ResearchSource } from '@/lib/learn/essays/research';
import { PAGE_TOKENS, searchTurn } from '@/lib/learn/essays/research-model';
import type { BriefDepth, SubQuestion } from './model';
import {
  finalText,
  FRAME_SYSTEM,
  framePrompt,
  readSearchResults,
  readSourceList,
  readSubQuestionLines,
  readWrittenBrief,
  researchBudget,
  searchPrompt,
  searchSystem,
  SUB_QUESTIONS_MIN,
  WRITE_SYSTEM,
  writePrompt,
  type ListedSource,
  type SearchResult,
  type WrittenBrief,
} from './research';

/**
 * The three calls of a brief's research (plan #2023.2). research.ts has the
 * prompts and reads what comes back; this file only makes the calls, and
 * reports every response's usage through `onSpend` so the run records the
 * whole cost under 'research-topic'.
 *
 * The search call is the essay deeper pass's gathering turn
 * (lib/learn/essays/research-model.ts, `searchTurn`): Haiku on the basic web
 * search and fetch tools, continued while the server pauses it. The write
 * call reads the fetched pages as documents with citations on, as the essay's
 * judge does, so every quote is a range the API located in a page.
 */

export const FRAME_MODEL = MODELS.learnBriefFrame;
export const SEARCH_MODEL = MODELS.learnBriefSearch;
export const WRITE_MODEL = MODELS.learnBriefWrite;

const FRAME_MAX_TOKENS = 1_000;
const WRITE_MAX_TOKENS = 6_000;

type Failure = { ok: false; detail: string };

function failure(error: unknown, fallback: string): Failure {
  return { ok: false, detail: error instanceof Error ? error.message : fallback };
}

/** Call 1: the question and why become three to five sub-questions. */
export async function frameQuestion(input: {
  question: string;
  angle: string;
  client: Anthropic;
  onSpend?: SpendSink;
}): Promise<{ ok: true; subQuestions: SubQuestion[] } | Failure> {
  let response;
  try {
    response = await input.client.messages.create({
      model: FRAME_MODEL,
      max_tokens: FRAME_MAX_TOKENS,
      system: FRAME_SYSTEM,
      messages: [{ role: 'user', content: framePrompt(input.question, input.angle) }],
    });
  } catch (error) {
    return failure(error, 'Framing the question failed.');
  }
  input.onSpend?.({ model: FRAME_MODEL, usage: usageFrom(response.usage) });
  const subQuestions = readSubQuestionLines(finalText(response.content));
  if (subQuestions.length < SUB_QUESTIONS_MIN) {
    return { ok: false, detail: `The question came back as ${subQuestions.length} sub-questions.` };
  }
  return { ok: true, subQuestions };
}

export type Gathered = {
  pages: ResearchSource[];
  results: SearchResult[];
  listed: ListedSource[];
  queries: string[];
};

/** Call 2: search for each sub-question, read the best pages, and list the sources worth keeping. */
export async function gatherSources(input: {
  question: string;
  angle: string;
  depth: BriefDepth;
  subQuestions: readonly SubQuestion[];
  client: Anthropic;
  onSpend?: SpendSink;
}): Promise<({ ok: true } & Gathered) | Failure> {
  const budget = researchBudget(input.depth, input.subQuestions.length);
  const turn = await searchTurn(
    input.client,
    searchSystem(budget),
    [
      { type: 'web_search_20250305', name: 'web_search', max_uses: budget.searches },
      { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: budget.pages, max_content_tokens: PAGE_TOKENS },
    ],
    searchPrompt(input.question, input.angle, input.subQuestions),
    input.onSpend,
    SEARCH_MODEL,
  );
  if (!turn.ok) return turn;
  const pages = readFetchedPages(turn.content).slice(0, budget.pages);
  if (pages.length === 0) return { ok: false, detail: 'No page could be read.' };
  return {
    ok: true,
    pages,
    results: readSearchResults(turn.content),
    listed: readSourceList(finalText(turn.content)),
    queries: searchQueries(turn.content),
  };
}

/** Call 3: a cited position for each sub-question and the short answer, from the pages read. */
export async function writeBrief(input: {
  question: string;
  angle: string;
  subQuestions: readonly SubQuestion[];
  pages: readonly ResearchSource[];
  client: Anthropic;
  onSpend?: SpendSink;
}): Promise<({ ok: true } & WrittenBrief) | Failure> {
  let response;
  try {
    response = await input.client.messages.create({
      model: WRITE_MODEL,
      max_tokens: WRITE_MAX_TOKENS,
      system: WRITE_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            ...input.pages.map((page) => ({
              type: 'document' as const,
              source: { type: 'text' as const, media_type: 'text/plain' as const, data: page.text ?? '' },
              title: `${page.title} (${page.domain})`,
              citations: { enabled: true },
            })),
            { type: 'text' as const, text: writePrompt(input.question, input.angle, input.subQuestions) },
          ],
        },
      ],
    });
  } catch (error) {
    return failure(error, 'Writing the brief failed.');
  }
  input.onSpend?.({ model: WRITE_MODEL, usage: usageFrom(response.usage) });
  const written = readWrittenBrief(response.content, input.pages, input.subQuestions);
  if (written.sections.length === 0) return { ok: false, detail: 'No answer came back with a quote from a page.' };
  return { ok: true, ...written };
}

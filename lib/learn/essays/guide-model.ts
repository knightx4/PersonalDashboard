import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { finalText, readSubQuestionLines, SUB_QUESTIONS_MIN } from '@/lib/learn/briefs/research';
import type { SubQuestion } from '@/lib/learn/briefs/model';
import { readFetchedPages, searchQueries, type ResearchSource } from './research';
import { PAGE_TOKENS, searchTurn } from './research-model';
import {
  MAP_FRAME_SYSTEM,
  MAP_PAGES,
  MAP_SEARCHES,
  MAP_WRITE_SYSTEM,
  mapSearchPrompt,
  mapWritePrompt,
  readMap,
  type ResearchMap,
} from './research-map';

/**
 * The guided essay's calls (docs/LEARN-ESSAYS-SPEC.md, "The stages"). guide.ts
 * and research-map.ts hold the prompts and read the replies; this file only
 * makes the calls and reports each response's usage through `onSpend`.
 *
 * Every system prompt is fixed text, so it can be cached; what is particular
 * to the essay goes in the user turn.
 */

export const GUIDE_MODEL = MODELS.learnEssayGuide;
export const MAP_SEARCH_MODEL = MODELS.learnEssayResearch;

type Failure = { ok: false; detail: string };

function failure(error: unknown, fallback: string): Failure {
  return { ok: false, detail: error instanceof Error ? error.message : fallback };
}

/** One Sonnet call with a fixed system prompt; the reply's text. */
export async function guideCall(input: {
  system: string;
  prompt: string;
  maxTokens: number;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<{ ok: true; text: string } | Failure> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  let response;
  try {
    response = await client.messages.create({
      model: GUIDE_MODEL,
      max_tokens: input.maxTokens,
      system: [{ type: 'text', text: input.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: input.prompt }],
    });
  } catch (error) {
    return failure(error, 'The call failed.');
  }
  input.onSpend?.({ model: GUIDE_MODEL, usage: usageFrom(response.usage) });
  return { ok: true, text: finalText(response.content) };
}

export type MapResult =
  | ({
      ok: true;
      subQuestions: SubQuestion[];
      sources: ResearchSource[];
      queries: string[];
    } & ResearchMap)
  | Failure;

/**
 * The research map: frame the question, search and read, then write the map
 * from the pages. `basis` is the brief's question and what would change the
 * writer's mind (research-map.ts, `mapBasis`), and nothing else reaches a
 * search.
 */
export async function runResearchMap(input: {
  basis: string;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<MapResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  const framed = await guideCall({
    system: MAP_FRAME_SYSTEM,
    prompt: input.basis,
    maxTokens: 1_000,
    anthropicApiKey: input.anthropicApiKey,
    client,
    onSpend: input.onSpend,
  });
  if (!framed.ok) return framed;
  const subQuestions = readSubQuestionLines(framed.text);
  if (subQuestions.length < SUB_QUESTIONS_MIN) {
    return { ok: false, detail: `The question came back as ${subQuestions.length} sub-questions.` };
  }

  const searched = await searchTurn(
    client,
    `You are gathering sources for someone researching a question before writing an essay
about it. Someone else writes up what the pages say; your job is to find and
read the right ones.

You have at most ${MAP_SEARCHES} web searches and may read at most ${MAP_PAGES} pages in full with
web_fetch. Search for each sub-question in turn, in general terms about the
subject. Prefer, in this order: regulators and standard-setters; professional
bodies and research institutes; established firms and serious press. Vendor
pages selling a product come last. Read in full the ${MAP_PAGES} pages most likely to
answer the sub-questions between them, including at least one that disagrees
with the others when there is one, and no PDF when an HTML page says the
same.

When you have read them, reply with the single word: Done.`,
    [
      { type: 'web_search_20250305', name: 'web_search', max_uses: MAP_SEARCHES },
      {
        type: 'web_fetch_20250910',
        name: 'web_fetch',
        max_uses: MAP_PAGES,
        max_content_tokens: PAGE_TOKENS,
      },
    ],
    mapSearchPrompt(input.basis, subQuestions),
    input.onSpend,
    MAP_SEARCH_MODEL,
  );
  if (!searched.ok) return searched;
  const pages = readFetchedPages(searched.content).slice(0, MAP_PAGES);
  if (pages.length === 0) return { ok: false, detail: 'No page could be read.' };

  let response;
  try {
    response = await client.messages.create({
      model: GUIDE_MODEL,
      max_tokens: 6_000,
      system: MAP_WRITE_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            ...pages.map((page) => ({
              type: 'document' as const,
              source: {
                type: 'text' as const,
                media_type: 'text/plain' as const,
                data: page.text ?? '',
              },
              title: `${page.title} (${page.domain})`,
              citations: { enabled: true },
            })),
            { type: 'text' as const, text: mapWritePrompt(input.basis, subQuestions) },
          ],
        },
      ],
    });
  } catch (error) {
    return failure(error, 'Writing up the research failed.');
  }
  input.onSpend?.({ model: GUIDE_MODEL, usage: usageFrom(response.usage) });
  const map = readMap(response.content, pages, subQuestions);
  if (map.parts.length === 0)
    return { ok: false, detail: 'No part came back with a quote from a page.' };
  return {
    ok: true,
    subQuestions,
    sources: pages,
    queries: searchQueries(searched.content),
    ...map,
  };
}

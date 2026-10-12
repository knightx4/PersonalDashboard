import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import {
  citedPages,
  DEEPER_PAGES,
  DEEPER_SEARCHES,
  FIRST_PASS_SEARCHES,
  FIRST_PASS_SYSTEM,
  GATHER_SYSTEM,
  gatherPrompt,
  JUDGE_SYSTEM,
  readClaims,
  readFetchedPages,
  readFirstPass,
  searchQueries,
  type ResearchClaim,
  type ResearchPosition,
  type ResearchSource,
} from './research';

/**
 * The research calls (plan #1863.9). research.ts has the prompts and reads
 * what comes back; this file only makes the calls.
 *
 * Haiku runs the searches. It takes the basic web search and web fetch tools
 * (`web_search_20250305`, `web_fetch_20250910`): the dynamic-filtering
 * versions need programmatic tool calling, which Haiku does not have, and
 * Jobs' company lookup has run the basic search on Haiku since September.
 * Sonnet judges the deeper pass's claims, reading the fetched pages as
 * documents with citations on, so every quote it gives is a range the API
 * located in a page.
 *
 * A turn the server pauses after many tool calls (`pause_turn`) is sent back
 * as it is, up to three times; every response's usage is reported, so the
 * ledger has the whole cost.
 */

export const RESEARCH_MODEL = MODELS.learnEssayResearch;
export const JUDGE_MODEL = MODELS.learnEssayJudge;

const CONTINUATIONS = 3;
/** Room for Haiku 5.5's thinking as well as the answer. */
const SEARCH_MAX_TOKENS = 8_000;
const JUDGE_MAX_TOKENS = 6_000;
/** The most of one fetched page that goes into the gathering call's context. */
const PAGE_TOKENS = 6_000;

type Failure = { ok: false; detail: string };

/** One tool turn, continued while the server pauses it; every block that came back, in order. */
async function searchTurn(
  client: Anthropic,
  system: string,
  tools: unknown[],
  prompt: string,
  onSpend?: SpendSink,
): Promise<{ ok: true; content: unknown[] } | Failure> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];
  const content: unknown[] = [];
  for (let turn = 0; turn <= CONTINUATIONS; turn += 1) {
    let response;
    try {
      response = await client.messages.create({
        model: RESEARCH_MODEL,
        max_tokens: SEARCH_MAX_TOKENS,
        system,
        // The installed SDK predates the server tools' types.
        tools: tools as Anthropic.Tool[],
        messages,
      });
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : 'The search failed.' };
    }
    onSpend?.({ model: RESEARCH_MODEL, usage: usageFrom(response.usage) });
    content.push(...response.content);
    // Widened: the installed SDK's type predates these reasons.
    const stop: string | null = response.stop_reason;
    if (stop === 'pause_turn') {
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }
    if (stop === 'refusal') return { ok: false, detail: 'The model declined the search.' };
    return { ok: true, content };
  }
  return { ok: true, content };
}

export type FirstPassResult =
  | { ok: true; positions: ResearchPosition[]; sources: ResearchSource[]; queries: string[] }
  | Failure;

/** The first pass: up to four searches on the question, three to five positions with their sources. */
export async function runFirstPass(input: {
  basis: string;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<FirstPassResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  const turn = await searchTurn(
    client,
    FIRST_PASS_SYSTEM,
    [{ type: 'web_search_20250305', name: 'web_search', max_uses: FIRST_PASS_SEARCHES }],
    input.basis,
    input.onSpend,
  );
  if (!turn.ok) return turn;
  const read = readFirstPass(turn.content);
  if (read.positions.length === 0) return { ok: false, detail: 'No position came back with a source.' };
  return { ok: true, ...read };
}

export type DeeperPassResult =
  | { ok: true; claims: ResearchClaim[]; sources: ResearchSource[]; queries: string[] }
  | Failure;

/**
 * The deeper pass: Haiku searches up to eight times and reads up to five
 * pages, then Sonnet marks each of the draft's claims against those pages.
 */
export async function runDeeperPass(input: {
  question: string;
  draft: string;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<DeeperPassResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  const gathered = await searchTurn(
    client,
    GATHER_SYSTEM,
    [
      { type: 'web_search_20250305', name: 'web_search', max_uses: DEEPER_SEARCHES },
      { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: DEEPER_PAGES, max_content_tokens: PAGE_TOKENS },
    ],
    gatherPrompt(input.question, input.draft),
    input.onSpend,
  );
  if (!gathered.ok) return gathered;
  const pages = readFetchedPages(gathered.content).slice(0, DEEPER_PAGES);
  const queries = searchQueries(gathered.content);
  if (pages.length === 0) return { ok: false, detail: 'No page could be read.' };

  let response;
  try {
    response = await client.messages.create({
      model: JUDGE_MODEL,
      max_tokens: JUDGE_MAX_TOKENS,
      system: JUDGE_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            ...pages.map((page) => ({
              type: 'document' as const,
              source: { type: 'text' as const, media_type: 'text/plain' as const, data: page.text ?? '' },
              title: `${page.title} (${page.domain})`,
              citations: { enabled: true },
            })),
            { type: 'text' as const, text: gatherPrompt(input.question, input.draft) },
          ],
        },
      ],
    });
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'Judging the claims failed.' };
  }
  input.onSpend?.({ model: JUDGE_MODEL, usage: usageFrom(response.usage) });
  const claims = readClaims(response.content, pages);
  if (claims.length === 0) return { ok: false, detail: 'No claim came back.' };
  return { ok: true, ...citedPages(claims, pages), queries };
}

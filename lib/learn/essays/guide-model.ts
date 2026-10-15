import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { finalText } from '@/lib/learn/briefs/research';
import { searchQueries } from './research';
import { searchTurn } from './research-model';
import { MAP_SEARCHES, MAP_SYSTEM, readMap, type ResearchMap } from './research-map';

/**
 * The guided essay's calls (docs/LEARN-ESSAYS-SPEC.md, "The stages"). guide.ts
 * and research-map.ts hold the prompts and read the replies; this file only
 * makes the calls and reports each response's usage through `onSpend`.
 *
 * Every system prompt is fixed text, so it can be cached; what is particular
 * to the essay goes in the user turn.
 */

export const GUIDE_MODEL = MODELS.learnEssayGuide;

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

export type MapResult = ({ ok: true; queries: string[] } & ResearchMap) | Failure;

/**
 * The research written up for the writer: one Sonnet call that searches (the
 * dynamic-filtering web search, which keeps only the relevant parts of each
 * result) and writes from what it found, citing the search results.
 */
export async function runResearchMap(input: {
  prompt: string;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<MapResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  const searched = await searchTurn(
    client,
    MAP_SYSTEM,
    [{ type: 'web_search_20260209', name: 'web_search', max_uses: MAP_SEARCHES }],
    input.prompt,
    input.onSpend,
    GUIDE_MODEL,
    16_000,
  );
  if (!searched.ok) return searched;
  const map = readMap(searched.content);
  if (map.findings.filter((f) => f.kind !== 'debate').length === 0) {
    return { ok: false, detail: 'Nothing came back with a source.' };
  }
  return { ok: true, queries: searchQueries(searched.content), ...map };
}

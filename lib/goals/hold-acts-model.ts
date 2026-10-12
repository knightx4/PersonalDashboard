import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import {
  ACTS_SENTENCE_SYSTEM,
  actsSentenceMessage,
  cleanActsSentence,
  type ActsCandidate,
} from '@/lib/goals/hold-acts';
import { MODELS } from '@/lib/core/models';

/**
 * Haiku writes the `acts` sentence for a step Jev held (plan #1183): what
 * working it does, who it goes to, from where, and what changes. Jev answers
 * yes or no and cannot write it.
 */

export const ACTS_SENTENCE_MODEL = MODELS.goalHoldActs;

/** The sentence, or null when there is no key, the call failed or nothing usable came back. */
export async function writeActsSentence(
  step: ActsCandidate,
  options: { apiKey?: string | null; client?: Anthropic; onSpend?: SpendSink } = {},
): Promise<string | null> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY ?? null;
  if (!options.client && !apiKey) return null;
  const client = options.client ?? new Anthropic({ apiKey: apiKey ?? undefined });
  try {
    const response = await client.messages.create({
      model: ACTS_SENTENCE_MODEL,
      max_tokens: 2_000, // room for Haiku 5.5's thinking as well as the answer
      system: ACTS_SENTENCE_SYSTEM,
      messages: [{ role: 'user', content: actsSentenceMessage(step) }],
    });
    options.onSpend?.({ model: ACTS_SENTENCE_MODEL, usage: usageFrom(response.usage) });
    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join(' ');
    return cleanActsSentence(text);
  } catch (error) {
    console.warn(`[goals] acts sentence not written: ${error instanceof Error ? error.message : 'failed'}`);
    return null;
  }
}

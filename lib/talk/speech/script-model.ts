/**
 * The Haiku call that writes a bubble's spoken version (plan #3079). One
 * short call with no tools; what comes back is scrubbed and kept by
 * script.ts, so this file only asks and reads.
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { SPOKEN_SCRIPT_SYSTEM, spokenScriptMessage } from '@/lib/talk/speech/script';

export const SPOKEN_SCRIPT_MODEL = MODELS.spokenScript;

/** How long the voice waits for a rewrite before it reads the bubble as it is. */
export const SPOKEN_SCRIPT_TIMEOUT_MS = 8_000;

/**
 * The spoken words for `bubble`, or null when there is no key, the call
 * failed or timed out, or nothing came back. Never throws.
 */
export async function writeSpokenScript(
  bubble: string,
  today: string,
  options: { apiKey?: string | null; client?: Pick<Anthropic, 'messages'>; onSpend?: SpendSink; timeoutMs?: number } = {},
): Promise<string | null> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY ?? null;
  if (!options.client && !apiKey) return null;
  const client = options.client ?? new Anthropic({ apiKey: apiKey ?? undefined });
  try {
    const response = await client.messages.create(
      {
        model: SPOKEN_SCRIPT_MODEL,
        max_tokens: 1_500, // room for Haiku 5.5's thinking as well as two sentences
        system: SPOKEN_SCRIPT_SYSTEM,
        messages: [{ role: 'user', content: spokenScriptMessage(bubble, today) }],
      },
      { timeout: options.timeoutMs ?? SPOKEN_SCRIPT_TIMEOUT_MS, maxRetries: 0 },
    );
    options.onSpend?.({ model: SPOKEN_SCRIPT_MODEL, usage: usageFrom(response.usage) });
    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join(' ')
      .trim();
    return text || null;
  } catch (error) {
    console.error('[speech] spoken script not written', error instanceof Error ? error.message : error);
    return null;
  }
}

import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { claimsText, readClaims, type EssayClaim } from './finish';

/**
 * The claims an essay argues (plan #1873): one Sonnet call, made when the
 * person presses Finish. The system prompt never changes, so it can be
 * cached; the essay goes in the user turn.
 */

export const CLAIMS_MODEL = MODELS.learnEssayClaims;

/** Exported for the test that checks it never changes by accident. */
export const CLAIMS_SYSTEM = `You are Dash. Someone has finished an essay and you list the claims it argues, so
their notes can hold each one.

A claim is a statement the essay says is true and that could be wrong: "Money
holds its value in a drawer only because everyone expects others to accept it."
Not a topic, a question or a fact the essay merely reports.

HOW
- Between two and eight claims, the ones the essay's argument rests on, most
  important first. Fewer when the essay makes fewer.
- name: two to six words that name the claim as a note title would, such as
  "Money is a shared expectation". No colon, no quotation marks.
- claim: the claim in one or two plain sentences, in the writer's own terms.
- Use only what the essay says. Add nothing, and quote no one.

Reply with JSON only, no code fence:
{"claims": [{"name": "...", "claim": "..."}]}`;

export type ClaimsResult = { ok: true; claims: EssayClaim[] } | { ok: false; detail: string };

export async function nameEssayClaims(input: {
  title: string;
  claim: string;
  draft: string;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<ClaimsResult> {
  const doc = claimsText(input.draft);
  if (!doc) return { ok: false, detail: 'The essay is empty.' };
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  let response;
  try {
    response = await client.messages.create({
      model: CLAIMS_MODEL,
      max_tokens: 1_200,
      system: [{ type: 'text', text: CLAIMS_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: `Title: ${input.title}\nThe writer's own statement of the claim: ${input.claim.trim() || '(not written)'}\n\n<essay>\n${doc}\n</essay>`,
        },
      ],
    });
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'Reading the claims failed.' };
  }
  input.onSpend?.({ model: CLAIMS_MODEL, usage: usageFrom(response.usage) });

  const reply = response.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
  const claims = readClaims(reply);
  return claims.length > 0
    ? { ok: true, claims }
    : { ok: false, detail: 'The reply held no claims in the form Finish reads.' };
}

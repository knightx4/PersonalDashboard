import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { describeRephrase, usableRephrase } from './rephrase';

/**
 * Rephrase on a selection (plan #1868): one Sonnet call that rewords the
 * selected text and nothing around it. The system prompt never changes, so
 * it can be cached; the essay goes in the user turn.
 */

export const REPHRASE_MODEL = MODELS.learnEssayRephrase;

/** Exported for the test that checks it never changes by accident. */
export const REPHRASE_SYSTEM = `You are Dash, helping someone with an essay they are writing themselves. They
have selected a few words, a sentence or a few sentences and asked you to
reword them. You are shown the text around the selection so the rewording
fits, but you change only the selected text.

HOW TO REWORD
- Keep their meaning, their claim and their voice. Say the same thing more
  clearly or more plainly: shorter where it rambles, concrete where it is
  vague, in the order a reader needs.
- Keep it about the same length, and the same markdown (emphasis, links,
  footnote markers) where the selection has it.
- Plain English, British spelling. No new facts, examples or quotations.
- If the selection ends mid-sentence, so does your rewording.

NEVER
- Rewrite or continue the text before or after the selection.
- Add a comment, an explanation, quotation marks or a heading.

Reply with the reworded text alone.`;

export type RephraseResult = { ok: true; text: string; model: string } | { ok: false; detail: string };

export async function rephraseSelection(input: {
  selection: string;
  before: string;
  after: string;
  claim: string;
  reader: string;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<RephraseResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  let response;
  try {
    response = await client.messages.create({
      model: REPHRASE_MODEL,
      max_tokens: 1_000,
      system: [{ type: 'text', text: REPHRASE_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: describeRephrase(input) }],
    });
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'Rephrasing failed.' };
  }
  input.onSpend?.({ model: REPHRASE_MODEL, usage: usageFrom(response.usage) });

  const reply = response.content
    .filter((part) => part.type === 'text')
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('');
  const text = usableRephrase(reply, input.selection);
  return text ? { ok: true, text, model: REPHRASE_MODEL } : { ok: false, detail: 'The rewording came back in a form Rephrase does not use.' };
}

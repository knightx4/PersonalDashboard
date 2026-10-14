/**
 * The Haiku call that reads a sentence typed into capture as an order (plan
 * #1950.3.1). One call, forced through one tool; the checking is
 * lib/orders/from-sentence.ts, so it is tested without a model.
 */
import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { forceTool } from '@/lib/learn/graph/tool-call';
import {
  ORDER_SENTENCE_SCHEMA,
  ORDER_SENTENCE_TOOL,
  orderSentenceMessage,
  readOrderSentenceReply,
  type OrderDraft,
} from '@/lib/orders/from-sentence';

const MODEL = MODELS.shoppingOrderSentence;

const SYSTEM = `The owner of a personal dashboard typed a sentence about
something they bought. Read it as an order and report it through
${ORDER_SENTENCE_TOOL}: the shop if one is named, the day if one is given, and
one line for each thing bought, with how many and the price of one in dollars.
Keep each name short, as a product would be listed. Leave out what the
sentence does not say rather than guessing it.`;

/**
 * The order the sentence describes, or null when the call failed or found no
 * line. Never throws; the caller then reads the sentence alone.
 */
export async function readOrderSentence(
  sentence: string,
  today: string,
  options: { client: Pick<Anthropic, 'messages'>; onSpend?: SpendSink },
): Promise<OrderDraft | null> {
  try {
    const response = await options.client.messages.create({
      model: MODEL,
      max_tokens: 800,
      system: SYSTEM,
      tools: [
        {
          name: ORDER_SENTENCE_TOOL,
          description: 'Report the order the sentence describes.',
          input_schema: ORDER_SENTENCE_SCHEMA as unknown as Anthropic.Tool['input_schema'],
        },
      ],
      tool_choice: forceTool(ORDER_SENTENCE_TOOL, MODEL),
      messages: [{ role: 'user', content: orderSentenceMessage(sentence, today) }],
    });
    options.onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });
    const block = response.content.find((part) => part.type === 'tool_use' && part.name === ORDER_SENTENCE_TOOL);
    return block && block.type === 'tool_use' ? readOrderSentenceReply(block.input, today) : null;
  } catch (error) {
    console.error('order sentence: the read failed', error);
    return null;
  }
}

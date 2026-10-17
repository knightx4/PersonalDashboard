import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { forceTool } from '@/lib/learn/graph/tool-call';
import type { CheckBatch } from './reply-check';

/**
 * The model call behind the weekly check of Ask Dash replies (plan #2285.3).
 * Haiku reads a week of chats and names, through a forced tool, each Dash
 * answer the person pushed back on, repeated themselves after or gave up on,
 * with a short quote of their words. readFlags checks what comes back.
 */

export const REPLY_CHECK_MODEL = MODELS.askReplyCheck;
const TOOL_NAME = 'flag_replies';

const SYSTEM = `You read a week of chats between a person and Dash, the
assistant in their personal app, and find the Dash answers that went badly.
Each turn is labelled, like [T12]. Dash's answers are cut to their first 600
characters.

Flag a Dash answer when the person's next turns show one of:
- pushed_back: they said it was wrong, not what they asked, or corrected it.
- repeated: they asked the same thing again, or restated it, because the
  answer missed it.
- gave_up: they dropped the question, did it themselves, or said not to
  bother, after an answer that did not help.

Give the label of the Dash answer that went badly in "reply", the kind, and
in "quote" the person's own words that show it, at most 140 characters,
copied as written. A follow-up question that builds on a good answer is not
pushing back. Flag nothing when nothing went badly; most chats go fine.`;

export type ReplyCheckModelOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Pick<Anthropic, 'messages'>;
  /** What the call cost; recorded as core 'check-ask-replies'. */
  onSpend?: SpendSink;
};

/** The flags as the model gave them, unchecked. Throws when the call fails. */
export async function checkAskReplies(batch: CheckBatch, options: ReplyCheckModelOptions): Promise<unknown> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  const response = await client.messages.create({
    model: REPLY_CHECK_MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    tools: [
      {
        name: TOOL_NAME,
        description: 'List the Dash answers that went badly, each with its label, the kind and the person\'s words.',
        input_schema: {
          type: 'object',
          properties: {
            flags: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  reply: { type: 'string' },
                  kind: { type: 'string', enum: ['pushed_back', 'repeated', 'gave_up'] },
                  quote: { type: 'string' },
                },
                required: ['reply', 'kind', 'quote'],
              },
            },
          },
          required: ['flags'],
        },
      },
    ],
    tool_choice: forceTool(TOOL_NAME, REPLY_CHECK_MODEL),
    messages: [{ role: 'user', content: `${batch.text}\n\nReport through ${TOOL_NAME}.` }],
  });
  options.onSpend?.({ model: REPLY_CHECK_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') return [];
  return (block.input as { flags?: unknown } | null)?.flags ?? [];
}

import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { THINKING_ROOM, forceTool } from '@/lib/learn/graph/tool-call';
import type { MonthFacts } from './facts';
import { reviewPrompt, type RawWording } from './write';

/**
 * The model call behind the monthly money review (plan #2593.8.2). One Sonnet
 * call a month per person, about the cost of one Ask Dash answer: the facts
 * go in with the code's own sentence for each, and a line per fact and a
 * short opening come back through a tool. checkWording reads the reply before
 * anything is stored.
 */

export const MONEY_REVIEW_MODEL = MODELS.moneyReview;
const TOOL_NAME = 'write_money_review';

const SYSTEM = `You are Dash, the assistant in a personal app. On the first
of each month you write the person a short review of their money in the
month before, from figures the app worked out from their own bank, card,
brokerage and loan accounts.

You are given facts, each with an id, a kind, a sentence the app wrote and
its figures. Rewrite each fact as one line for the person, addressed as
"you", in at most 40 words, and write a one or two sentence opening for the
whole month.

Rules:
- Write a line for every fact, citing it by id in "fact". The id never goes
  in the text.
- Every number in a line must appear in that fact's sentence, written the
  same way. Do not add, subtract, round, or work out percentages or
  differences. A line with any other number is thrown away.
- The opening may only use numbers from the facts' sentences. It says what
  most stands out in the month: spending against the months before, a new or
  dearer subscription, a large charge, interest paid, or a payment coming due.
- Say what happened, not why. Do not guess at causes or feelings, do not
  praise or scold, and do not give advice beyond a payment that is coming due.
- Plain words. No greeting, no sign-off, no em dashes, no exclamation marks,
  no quotation marks.`;

export type MoneyReviewModelOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Pick<Anthropic, 'messages'>;
  /** What the call cost; recorded as finances 'write-money-review'. */
  onSpend?: SpendSink;
};

/**
 * The model's wording, unchecked, or null when it returned no tool call.
 * Throws when the call itself fails, which the run records as a failed review.
 */
export async function wordMoneyReview(facts: MonthFacts, options: MoneyReviewModelOptions): Promise<RawWording | null> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });

  const response = await client.messages.create({
    model: MONEY_REVIEW_MODEL,
    max_tokens: 2500 + THINKING_ROOM,
    system: SYSTEM,
    tools: [
      {
        name: TOOL_NAME,
        description: 'Give the month review: an opening, and one line per fact citing the fact by id.',
        input_schema: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            lines: {
              type: 'array',
              items: {
                type: 'object',
                properties: { fact: { type: 'string' }, text: { type: 'string' } },
                required: ['fact', 'text'],
              },
            },
          },
          required: ['summary', 'lines'],
        },
      },
    ],
    tool_choice: forceTool(TOOL_NAME, MONEY_REVIEW_MODEL),
    messages: [{ role: 'user', content: `${reviewPrompt(facts)}\n\nReport through ${TOOL_NAME}.` }],
  });
  options.onSpend?.({ model: MONEY_REVIEW_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') return null;
  return (block.input ?? null) as RawWording | null;
}

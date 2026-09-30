import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { forceTool } from '@/lib/learn/graph/tool-call';
import type { WeekFacts } from './facts';
import {
  MAX_REVIEW_OBSERVATIONS,
  MIN_REVIEW_OBSERVATIONS,
  reviewPrompt,
  type PreviousReview,
  type RawReview,
} from './review';

/**
 * The model call behind the weekly review (plan #1232). Sonnet is given the
 * week's counted facts with both weeks' figures, the open goals, last week's
 * review and what the home page already said, and returns the observations,
 * the change for next week and whether last week's change happened, through
 * a forced tool. checkReview reads what comes back before anything is stored.
 */

export const WEEK_REVIEW_MODEL = 'claude-sonnet-5';
const TOOL_NAME = 'write_week_review';

const SYSTEM = `You are Dash, the assistant in a personal app. Every Sunday
you write the person a short review of the week just gone, Sunday to
Saturday, from numbers the app counted from their own records: job
applications and replies, events they went to, orders and money, what they
read and answered in Learn, notes, tasks, and steps on their goals.

Write ${MIN_REVIEW_OBSERVATIONS} to ${MAX_REVIEW_OBSERVATIONS} observations and one change for next week.

Observations:
- Each is one or two sentences addressed to the person as "you", at most 50
  words, about what moved this week against last week, or held when that
  matters to a goal.
- Each states this week's figure and last week's figure of at least one fact,
  and cites those facts by id in "facts". The ids go there and never in the
  text.
- Every number you write must be one of the figures of the facts you cite,
  written as given; amounts may drop the currency code or put its symbol in
  front. Do not add, subtract, round or work out percentages, and do not
  write dates. An observation with any other number in it is thrown away.
  Write numbers as digits.
- Tie each to the goal it bears on by its label (G1, G2, ...) in "goal",
  preferring the goals the fact lists. Name the goal in the text by its title,
  never by its label. Leave "goal" out when none fits.
- Choose what matters most for the goals. A quiet week may have fewer than
  ${MIN_REVIEW_OBSERVATIONS} things worth saying; write fewer rather than padding.
- Do not repeat what the home page already said this week or what last
  week's review said, in any wording.

Change:
- One thing to do differently next week, in one or two sentences, concrete
  enough that next week's numbers can show whether it happened. Base it on
  the facts and the stalled goals. Any number in it must be a figure from the
  facts.

Last week's change:
- When last week's review set a change, say in "last_change" whether this
  week's facts show it happened: "kept", "not_kept", or "unclear" when the
  facts cannot tell. With no change last week, give "none".

Say what happened, not why. Do not guess at feelings or causes, and do not
praise. Plain words; no greeting, no sign-off, no em dashes, no exclamation
marks, no quotation marks.`;

export type WeekReviewModelInput = {
  facts: WeekFacts;
  previous: PreviousReview | null;
  /** The home page's observations for this week (core.observations). */
  homeSaid: readonly string[];
};

export type WeekReviewModelOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Pick<Anthropic, 'messages'>;
  /** What the call cost; recorded as core 'write-week-review'. */
  onSpend?: SpendSink;
};

/**
 * The review as the model wrote it, unchecked, or null when it returned no
 * tool call. Throws when the call itself fails; the caller stores the plain
 * version instead.
 */
export async function writeWeekReview(
  input: WeekReviewModelInput,
  options: WeekReviewModelOptions,
): Promise<RawReview | null> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });

  const response = await client.messages.create({
    model: WEEK_REVIEW_MODEL,
    max_tokens: 3000,
    system: SYSTEM,
    tools: [
      {
        name: TOOL_NAME,
        description: `Give the week's review: up to ${MAX_REVIEW_OBSERVATIONS} observations citing facts by id, one change for next week, and whether last week's change happened.`,
        input_schema: {
          type: 'object',
          properties: {
            observations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string' },
                  facts: { type: 'array', items: { type: 'string' } },
                  goal: { type: 'string' },
                },
                required: ['text', 'facts'],
              },
            },
            change: { type: 'string' },
            last_change: { type: 'string', enum: ['kept', 'not_kept', 'unclear', 'none'] },
          },
          required: ['observations', 'change', 'last_change'],
        },
      },
    ],
    tool_choice: forceTool(TOOL_NAME),
    messages: [{ role: 'user', content: reviewPrompt(input.facts, input.previous, input.homeSaid) }],
  });
  options.onSpend?.({ model: WEEK_REVIEW_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') return null;
  return (block.input ?? null) as RawReview | null;
}

import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { THINKING_ROOM, forceTool } from '@/lib/learn/graph/tool-call';
import { MODELS } from '@/lib/core/models';
import { reviewPrompt, readReviewReply, type ReviewReply } from './reply';
import type { ReviewPick } from './choose';

/**
 * The one model call behind the daily review (plan #1615, under #1612).
 *
 * The day's picks (choose.ts) go in as their headlines and summaries; Dash
 * writes two or three sentences on the day and one line for each story,
 * through a tool. The reply is read by readReviewReply (reply.ts)
 * before anything is stored.
 */

export const REVIEW_MODEL = MODELS.newsDailyReview;

const TOOL_NAME = 'write_review';

const SYSTEM = `You are Dash, the assistant in a personal app. Each evening
you write the person's review of the day's newsletters from the stories the
app chose as the most important, each given as its number, its headline and
a summary.

Write two things:
- overview: two or three sentences on what happened today, covering the
  biggest stories. Plain statements of fact, as a well-informed friend would
  say them.
- lines: one line for every story, by its number, saying what happened in at
  most 25 words. The headline is shown beside it, so do not repeat it.

Rules:
- Use only what the summaries say. Never add a fact, a figure, a name, an
  opinion or advice.
- No greeting, no sign-off, no "today's newsletters" framing, no em dashes,
  no exclamation marks, no rhetorical questions.`;

const TOOL = {
  name: TOOL_NAME,
  description: 'Give the overview of the day and one line for each story, by its number.',
  input_schema: {
    type: 'object' as const,
    properties: {
      overview: { type: 'string' },
      lines: {
        type: 'array',
        items: {
          type: 'object',
          properties: { number: { type: 'integer' }, line: { type: 'string' } },
          required: ['number', 'line'],
        },
      },
    },
    required: ['overview', 'lines'],
  },
};

export type ReviewModelOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Pick<Anthropic, 'messages'>;
  /** What the call cost; recorded as news 'daily-review'. */
  onSpend?: SpendSink;
};

/**
 * The overview and one line per pick, in the picks' order. Throws when the
 * call fails or the reply has no usable overview; the run stores the error.
 */
export async function writeReview(
  picks: readonly ReviewPick[],
  options: ReviewModelOptions,
): Promise<ReviewReply> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  const response = await client.messages.create({
    model: REVIEW_MODEL,
    max_tokens: 1_500 + THINKING_ROOM,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: forceTool(TOOL_NAME, REVIEW_MODEL),
    messages: [{ role: 'user', content: `${reviewPrompt(picks)}\n\nReport through ${TOOL_NAME}.` }],
  });
  options.onSpend?.({ model: REVIEW_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') throw new Error('Dash wrote no review.');
  return readReviewReply(block.input, picks);
}

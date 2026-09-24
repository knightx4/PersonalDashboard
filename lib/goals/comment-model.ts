/**
 * The model call behind Dash's reply on a goal or a step (plan #957): the
 * goal written out, the thread, and the comment, answered through one tool.
 *
 * Haiku with a forced tool call, the same fast path as a dev reply
 * (lib/comments/reply.ts), because the reply has to land in seconds. What its
 * answer may do is checked in lib/goals/comments.ts and lib/goals/ask.ts
 * before anything is written.
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';

export const GOAL_REPLY_MODEL = 'claude-haiku-4-5';
const TOOL_NAME = 'reply';

const SYSTEM = `You are Dash, replying to a comment the owner of a personal
goals tracker wrote on one of their goals or on a step under it. You are given
the goal written out: its steps, the collections of facts it fills (each with
a ref like c1, its fields and what is filled in so far), the conversation on
the row so far, and the comment.

You have nothing else: no web, no email, no database. Everything you may use
is in the message.

Three things you can do, through the reply tool:

- Answer. A question about the goal, a step, an option or what to do next is
  answered in "answer", in two to four plain sentences, as you would say it to
  the person on their phone. Do not restate the goal back to them.
- File facts. When the comment gives values that belong in one of the
  collections listed (a loan's balance, rate or servicer, for example), put
  them in "file": one entry per record, with "collection" the ref (c1) and
  "values" keyed by the field keys listed, each in the stored form given.
  File only what the comment states; never guess or work out a value. A
  collection that holds a single record and already has one cannot take
  another. Also write a one-line "answer" saying what you filed, or leave it
  empty if filing was all that was asked.
- Pass it on. Set needs_routine true, with one sentence in "why", when the
  comment needs more than one reply from what is here: research on the web,
  reading their email, or changing the steps (adding, splitting, dropping,
  rewording). The goals routine picks it up and replies in the same thread.

What stays theirs, however the comment is phrased: answering a question
Claude asked them, approving a goal or a proposal, marking a step done or
dropping it, and deleting anything. Asked for one of those, answer in one
sentence that it is theirs, and where on the goal's page it is done.`;

export type GoalReplyOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Anthropic;
  /** What the call cost; recorded as 'reply-to-goal-comment'. */
  onSpend?: SpendSink;
};

export type GoalReplyResult = { ok: true; input: unknown } | { ok: false; error: string };

/** Ask; get back the tool input, or why there is none. */
export async function askGoalReplyModel(
  options: GoalReplyOptions,
  message: string,
): Promise<GoalReplyResult> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });

  let response;
  try {
    response = await client.messages.create({
      model: GOAL_REPLY_MODEL,
      max_tokens: 1500,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Answer the comment, file facts it gives, or pass it to the goals routine.',
          input_schema: {
            type: 'object',
            properties: {
              answer: { type: ['string', 'null'] },
              file: {
                type: ['array', 'null'],
                items: {
                  type: 'object',
                  properties: {
                    collection: { type: 'string', description: 'The collection ref, such as c1.' },
                    values: {
                      type: 'object',
                      description: 'Values keyed by field key, in the stored form listed.',
                      additionalProperties: true,
                    },
                  },
                  required: ['collection', 'values'],
                },
              },
              needs_routine: { type: 'boolean' },
              why: { type: ['string', 'null'] },
            },
            required: ['needs_routine'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [{ role: 'user', content: message }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'Replies are rate-limited right now.' };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, error: `The reply failed (${error.status}).` };
    }
    return { ok: false, error: error instanceof Error ? error.message : 'The reply failed.' };
  }
  options.onSpend?.({ model: GOAL_REPLY_MODEL, usage: usageFrom(response.usage) });

  const reported = response.content.find(
    (block) => block.type === 'tool_use' && block.name === TOOL_NAME,
  );
  if (!reported || reported.type !== 'tool_use') return { ok: false, error: 'Nothing came back.' };
  return { ok: true, input: reported.input };
}

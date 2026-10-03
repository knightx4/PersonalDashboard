import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { forceTool } from '@/lib/learn/graph/tool-call';
import { MAX_EVIDENCE, MAX_OBSERVATIONS, type RawObservation } from './observations';
import { MODELS } from '@/lib/core/models';

/**
 * The model call behind the weekly observations (plan #1119). Sonnet reads
 * the summary from summariseTimeline and returns up to three observations
 * through a forced tool, each with the short ids of the events behind it.
 * What comes back is checked by checkObservations before anything is stored.
 */

export const OBSERVATIONS_MODEL = MODELS.timelineObservations;
const TOOL_NAME = 'report_observations';

const SYSTEM = `You read a summary of twelve weeks of one person's life as their
own app recorded it: orders and returns, job applications and what came of
them, tasks done, notes written, Learn answers and readings, and steps closed
on their goals. You are Dash, the assistant in that app.

Find at most ${MAX_OBSERVATIONS} things the numbers show that cross two or more
of those areas, which the person would not see by looking at one area alone.
For example: more spent in the weeks after a rejection than in other weeks;
no notes written in the weeks that had interviews; goal steps stopping in the
month spending rose.

Rules:
- Each observation is one sentence addressed to the person as "you", at most
  40 words, and states at least one number taken from the summary: a count,
  an amount, or a comparison of two of them.
- It must rest on events from at least two areas, and cite them by their ids
  (E1, E2, ...) from the list: the events the number is counted from, up to
  ${MAX_EVIDENCE}. Cite only ids that appear in the list.
- The ids go in evidence and nowhere else. Never write one in the sentence,
  not even in brackets: the person reads the sentence and the ids mean
  nothing to them. Name the thing instead, such as the Acme interview.
- Say what happened together, not why. Do not guess at feelings or causes.
- Skip anything a single area already shows, such as "you applied to 30
  roles". Skip patterns resting on one or two weeks of data.
- Do not repeat anything under "Marked not useful", in any wording, or any
  observation under "Already said".
- Returning none is a good answer. Most weeks have nothing worth saying;
  return an empty list rather than a weak or obvious observation.
- No em dashes, no exclamation marks, no quotation marks.`;

export type ObservationsModelInput = {
  /** From summariseTimeline. */
  summary: string;
  /** Sentences the person marked not useful in the last three months. */
  notUseful: readonly string[];
  /** Observations already made in the last few weeks. */
  recent: readonly string[];
};

export type ObservationsModelOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Pick<Anthropic, 'messages'>;
  /** What the call cost; recorded as 'write-observations'. */
  onSpend?: SpendSink;
};

/** The user turn: the lists to avoid, then the summary. */
export function observationsPrompt(input: ObservationsModelInput): string {
  const list = (items: readonly string[]) => (items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : '(none)');
  return [
    'Marked not useful:',
    list(input.notUseful),
    '',
    'Already said:',
    list(input.recent),
    '',
    input.summary,
  ].join('\n');
}

/**
 * The observations the model gave, unchecked, or an empty list when it gave
 * none. Throws when the call itself fails, so the cron's reply shows a
 * failure rather than a quiet week.
 */
export async function writeObservations(
  input: ObservationsModelInput,
  options: ObservationsModelOptions,
): Promise<RawObservation[]> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });

  const response = await client.messages.create({
    model: OBSERVATIONS_MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    tools: [
      {
        name: TOOL_NAME,
        description: `Report what you noticed: up to ${MAX_OBSERVATIONS} observations, or an empty list.`,
        input_schema: {
          type: 'object',
          properties: {
            observations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sentence: { type: 'string' },
                  evidence: { type: 'array', items: { type: 'string' } },
                },
                required: ['sentence', 'evidence'],
              },
            },
          },
          required: ['observations'],
        },
      },
    ],
    tool_choice: forceTool(TOOL_NAME),
    messages: [{ role: 'user', content: observationsPrompt(input) }],
  });
  options.onSpend?.({ model: OBSERVATIONS_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') return [];
  const reported = (block.input as { observations?: unknown }).observations;
  return Array.isArray(reported) ? (reported as RawObservation[]) : [];
}

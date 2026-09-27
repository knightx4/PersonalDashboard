import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { forceTool } from '@/lib/learn/graph/tool-call';
import { MAX_PARAGRAPH_EVIDENCE, YEAR_TOPICS, type RawParagraph } from './year-review';

/**
 * The model call behind the year in review (plan #1121). Sonnet reads the
 * summary from summariseYear and writes up to one paragraph per topic through
 * a forced tool, each with the short ids of the events it is about. What
 * comes back is checked by checkParagraphs before anything is stored, the
 * same way as the weekly observations (observations-model.ts).
 */

export const YEAR_REVIEW_MODEL = 'claude-sonnet-5';
const TOOL_NAME = 'write_year_review';

const SYSTEM = `You read a summary of one year of a person's life as their own
app recorded it: orders and returns, job applications and what came of them,
tasks done, notes written, Learn answers and readings, and steps closed on
their goals. You are Dash, the assistant in that app, writing the year up for
them.

Write at most one short paragraph for each of these topics, and skip any
topic the year holds nothing for:
- shopping: what they bought and spent, and where.
- jobs: where the job search went: applications, interviews, offers,
  rejections, and when in the year they came.
- learning: what they learned in Learn and wrote in their notes.
- goals: the goals that moved and the tasks they finished.
- across: what held across the year when the months are read side by side,
  such as the months that were busiest in one area and quiet in another.

Rules:
- Address the person as "you". Two to four plain sentences per paragraph.
- Every number you write must appear under "The numbers the page shows",
  written the same way, amounts included. Do not add, subtract, round or work
  out percentages, and do not write dates or days of the month; name the
  month instead. A paragraph with any other number in it is thrown away.
- Each paragraph states at least one of those numbers.
- Cite the events the paragraph is about by their ids (E1, E2, ...) from the
  list, up to ${MAX_PARAGRAPH_EVIDENCE}: the ones it counts or names. Cite only
  ids that appear in the list.
- The ids go in evidence and nowhere else. Never write one in the paragraph,
  not even in brackets: the person reads the paragraph and the ids mean
  nothing to them. Name the thing instead, such as the Acme interview.
- Say what happened, not why. Do not guess at feelings or causes, and do not
  praise, encourage or advise.
- No em dashes, no exclamation marks, no quotation marks.`;

export type YearReviewModelOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Pick<Anthropic, 'messages'>;
  /** What the call cost; recorded as 'write-year-review'. */
  onSpend?: SpendSink;
};

/**
 * The paragraphs the model gave, unchecked, or an empty list when it gave
 * none. Throws when the call itself fails, so the caller shows a failure
 * rather than an empty review.
 */
export async function writeYearParagraphs(
  summary: string,
  options: YearReviewModelOptions,
): Promise<RawParagraph[]> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });

  const response = await client.messages.create({
    model: YEAR_REVIEW_MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    tools: [
      {
        name: TOOL_NAME,
        description: 'Write the year up: at most one paragraph per topic, each with the ids of the events it is about.',
        input_schema: {
          type: 'object',
          properties: {
            paragraphs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  topic: { type: 'string', enum: [...YEAR_TOPICS] },
                  text: { type: 'string' },
                  evidence: { type: 'array', items: { type: 'string' } },
                },
                required: ['topic', 'text', 'evidence'],
              },
            },
          },
          required: ['paragraphs'],
        },
      },
    ],
    tool_choice: forceTool(TOOL_NAME),
    messages: [{ role: 'user', content: summary }],
  });
  options.onSpend?.({ model: YEAR_REVIEW_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') return [];
  const written = (block.input as { paragraphs?: unknown }).paragraphs;
  return Array.isArray(written) ? (written as RawParagraph[]) : [];
}

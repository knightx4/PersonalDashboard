import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { MAX_SUGGESTIONS } from '@/lib/digest/build';

/**
 * The half of the morning summary that is a reading rather than a query.
 *
 * Everything else on the summary is a fact the database already holds. This
 * is the part that needs somebody to look at the whole board at once and
 * notice something: an idea nobody has shaped in a fortnight, two open
 * questions holding up the same feature, a step blocked so long that the
 * thing it was waiting for has probably happened.
 *
 * Called once a day by the cron, never by a page. It is the reason the
 * summary is stored rather than computed on load.
 */

const MODEL = 'claude-haiku-4-5';
const TOOL_NAME = 'report_suggestions';

const suggestionsSchema = z.object({
  suggestions: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        detail: z.string().max(600).nullish(),
      }),
    )
    .max(10),
});

export type DigestSuggestion = { title: string; detail: string | null };

const SYSTEM = `You are reading the state of one person's build plan and writing the
short "worth a look" list at the top of their dev page. They see it once, in
the morning, next to a list of what shipped overnight and a list of what is
ready to be picked up.

Say only what those two lists do not already say. A step that is ready is
already on the page; repeating it is noise. What is worth writing down is a
pattern across rows: an idea filed weeks ago that nobody has shaped, two open
questions that hold up the same feature, a feature whose steps are all closed
but which is still open itself, a step blocked on something that has since
been answered, a fog note that has sat unresolved while the feature under it
was built.

At most ${MAX_SUGGESTIONS}, and fewer is better. An empty list is a good
answer and a common one -- most mornings there is nothing to notice, and a
list padded to three teaches them to stop reading it.

Each one: the title says what you noticed in one sentence, naming the rows by
their #number. The detail says what to do about it, in one sentence. Do not
recommend building anything specific -- that is what the plan is for. Do not
speculate about what the code does; you have not seen it.

Write plainly. No stock phrases, no "consider whether", no claims that
something matters.`;

/** What the model is shown. Every list is already capped by the caller. */
export type DigestContext = {
  openDecisions: string[];
  unshapedIdeas: string[];
  blockedSteps: string[];
  fogPatches: string[];
  openRaises: string[];
  shipped: string[];
  inProgress: string[];
};

function section(heading: string, lines: readonly string[]): string[] {
  if (lines.length === 0) return [];
  return ['', heading, ...lines.map((line) => `- ${line}`)];
}

export function buildPrompt(context: DigestContext): string {
  const lines = [
    'The plan as it stands this morning.',
    ...section('Questions waiting on them:', context.openDecisions),
    ...section('Steps blocked:', context.blockedSteps),
    ...section('Fog -- features nobody can write steps for yet:', context.fogPatches),
    ...section('Ideas filed and not yet shaped, with how long ago:', context.unshapedIdeas),
    ...section('Raised and not yet answered:', context.openRaises),
    ...section('Underway right now:', context.inProgress),
    ...section('Closed in the last day, which they can already see:', context.shipped),
    '',
    `Call ${TOOL_NAME}. Return no suggestions if nothing here is worth their morning.`,
  ];
  return lines.join('\n');
}

/**
 * Never throws. A summary with no suggestions on it is a working summary; a
 * cron stage that fell over because the model was rate limited is not.
 */
export async function suggestForDigest(input: {
  context: DigestContext;
  apiKey: string;
  client?: Anthropic;
}): Promise<DigestSuggestion[]> {
  const client = input.client ?? new Anthropic({ apiKey: input.apiKey });

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report what is worth a look this morning, or nothing.',
          input_schema: {
            type: 'object',
            properties: {
              suggestions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    detail: { type: ['string', 'null'] },
                  },
                  required: ['title'],
                },
              },
            },
            required: ['suggestions'],
          },
        },
      ],
      messages: [{ role: 'user', content: buildPrompt(input.context) }],
    });
  } catch (error) {
    console.error('[dev digest] suggestions', error instanceof Error ? error.message : error);
    return [];
  }

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') return [];

  const safe = suggestionsSchema.safeParse(block.input);
  if (!safe.success) return [];

  return safe.data.suggestions.map((suggestion) => ({
    title: suggestion.title,
    detail: suggestion.detail ?? null,
  }));
}

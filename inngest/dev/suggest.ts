import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { z } from 'zod';
import { MAX_SUGGESTIONS } from '@/lib/digest/build';

/**
 * The half of the morning summary that is a reading rather than a query.
 *
 * Two things come back from one call. The account of the day is two or three
 * sentences saying what yesterday amounted to, which the page prints above the
 * rows that closed -- fifty-four one-line entries is a list and not a summary.
 * The "worth a look" list is what needs somebody to see the whole board at
 * once: an idea nobody has shaped in a fortnight, two open questions holding up
 * the same feature, a step blocked so long that the thing it was waiting for
 * has probably happened.
 *
 * Called once a day by the cron, never by a page. It is the reason the
 * summary is stored rather than computed on load.
 */

const MODEL = 'claude-haiku-4-5';
const TOOL_NAME = 'report_morning';

const morningSchema = z.object({
  summary: z.string().max(1200).nullish(),
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

export type DigestReading = {
  /** Two or three sentences on the day. Null when the call produced none. */
  summary: string | null;
  suggestions: DigestSuggestion[];
};

const SYSTEM = `You are reading the state of one person's build plan and writing the
top of their dev page. They see it once, in the morning, above a list of what
shipped overnight and a list of what is ready to be picked up.

Two things, in one call.

The summary is two or three sentences saying what the day amounted to. It goes
above the list of what closed, which on a busy day is fifty lines nobody reads
to the bottom of.

Write it the way you would tell them over a coffee. Lead with where the work
was -- each closed line below says which workspace it was in -- and then say in
their own words what got built there: "Mostly Learn: importing a document now
keeps its headings, and you can take a quiz on material you choose. Also a
colour picker on the dev pages." Which workspaces moved, and what each can now
do that it could not yesterday.

A #number never does the work of a name. They do not know what #341 is, and a
summary that says "#341 and #342 shipped" has told them nothing. Say the thing,
and put the number after it in brackets only where they would plausibly go and
open it. Never a bare list of numbers.

Stay at the height they think at. What the feature does, not how it was done:
no file names, no function or column names, no describing the mechanism. "The
theme picker waits for a click now", not "the hover handler was removed".

A day with nothing closed is one sentence saying so. Never open with
"Yesterday" or "Today"; the page already prints the date.

The suggestions are the "worth a look" list. Say only what the two lists below
them do not already say. A step that is ready is already on the page; repeating
it is noise. What is worth writing down is a pattern across rows: an idea filed weeks ago that nobody has shaped, two open
questions that hold up the same feature, a feature whose steps are all closed
but which is still open itself, a step blocked on something that has since
been answered, a fog note that has sat unresolved while the feature under it
was built.

At most ${MAX_SUGGESTIONS}, and fewer is better. An empty list is a good
answer and a common one -- most mornings there is nothing to notice, and a
list padded to three teaches them to stop reading it.

Each one: the title says what you noticed in one sentence. Name a row by what
it is and put its #number after it, the same rule as the summary -- "the import
question nobody has answered (#341)", never "#341". The detail says what to do
about it, in one sentence. Do not recommend building anything specific -- that
is what the plan is for. Do not speculate about what the code does; you have
not seen it.

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
    ...section(
      'Closed in the last day, which they can already see. Each line is the workspace it was in, then what it was:',
      context.shipped,
    ),
    '',
    `Call ${TOOL_NAME}. Write the summary from what closed in the last day: where the`,
    'work was, and what those workspaces can do now that they could not. Return no',
    'suggestions if nothing here is worth their morning.',
  ];
  return lines.join('\n');
}

const NOTHING: DigestReading = { summary: null, suggestions: [] };

/**
 * Never throws. A summary with no suggestions and no account of the day on it
 * is a working summary; a cron stage that fell over because the model was rate
 * limited is not.
 */
export async function suggestForDigest(input: {
  context: DigestContext;
  apiKey: string;
  client?: Anthropic;
  /** What the call cost; record it as 'suggest-from-digest'. */
  onSpend?: SpendSink;
}): Promise<DigestReading> {
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
          description: 'Report what the day amounted to, and what is worth a look.',
          input_schema: {
            type: 'object',
            properties: {
              summary: { type: ['string', 'null'] },
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
            required: ['summary', 'suggestions'],
          },
        },
      ],
      messages: [{ role: 'user', content: buildPrompt(input.context) }],
    });
  } catch (error) {
    console.error('[dev digest] suggestions', error instanceof Error ? error.message : error);
    return NOTHING;
  }
  input.onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') return NOTHING;

  const safe = morningSchema.safeParse(block.input);
  if (!safe.success) return NOTHING;

  const summary = safe.data.summary?.trim();
  return {
    summary: summary && summary.length > 0 ? summary : null,
    suggestions: safe.data.suggestions.map((suggestion) => ({
      title: suggestion.title,
      detail: suggestion.detail ?? null,
    })),
  };
}

import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import type { ReturnAngleRequest, ReturnAngleResult } from './level3';
import { describeProgress, NAME_MATERIAL_MODEL } from './name-material';

/**
 * Naming the new angle for a Level 3 article coming back (plan #912).
 *
 * The person said Got it to a card from this article, or saved one, and has
 * not been tested on it yet. The article is fixed, because a right answer on
 * its Test me track is what moves it to tested. What the model chooses is the
 * section: one of the sections no earlier card was cut from, which goes past
 * the earlier cards or comes at the subject from another side, a step harder
 * each time it comes back. The pass checks the reply against the sections it
 * offered, so a section it was not given is dropped.
 *
 * The same model as the ordinary naming call, and one call per return.
 */

const TOOL_NAME = 'report_angle';

const SYSTEM = `You choose which section of one English Wikipedia article a person should read next.

They have already had cards from this article and said they know it, but they
have not been tested on it. It is coming back so they meet it again from a
different side, a little harder than before, rather than seeing the same thing
twice.

You are given the article, the titles of the cards they already had from it,
and the sections still open to you. Choose one of those sections.

What makes a good choice:
- It goes past the earlier cards: a mechanism, an application, a real case, a
  measured result, a failure, or a disagreement that the earlier cards did not
  cover.
- It is a step harder than the earlier cards, more so the more times the
  article has come back.
- It is never a list of names, links or works, and never a restatement of what
  the earlier cards said.

Rules:
- Name one section exactly as it appears in the list you are given, or null
  for the lead only when the lead is in the list.
- "basis" is one sentence, under 25 words, saying what this section adds past
  the earlier cards.

Report through ${TOOL_NAME}.`;

const payloadSchema = z.object({
  section: z.string().nullable().optional(),
  basis: z.string(),
});

/** What the model is told about the return. Exported for the test. */
export function describeReturn(request: ReturnAngleRequest): string {
  const times = request.returns === 0 ? 'the first time' : `time ${request.returns + 1}`;
  return [
    `The article: ${request.article} (on the Level 3 vital articles list, under ${request.listSection}).`,
    `This is ${times} it has come back.`,
    '',
    'Cards they already had from this article; the new one must not repeat them:',
    ...request.earlier.map((title) => `- ${title}`),
    '',
    describeProgress(request.depth),
    '',
    'Sections you may choose from:',
    ...request.sections.map((heading) => `- ${heading ?? '(the lead)'}`),
    '',
    `Call ${TOOL_NAME} with one section.`,
  ].join('\n');
}

/** Read the tool payload. Pure, and exported for the test. */
export function readAngle(input: unknown): ReturnAngleResult {
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, detail: 'The report did not match its schema.' };
  const basis = parsed.data.basis.trim();
  if (!basis) return { ok: false, detail: 'The report gave no reason for its choice.' };
  const section = parsed.data.section?.trim() || null;
  return { ok: true, section, basis, model: NAME_MATERIAL_MODEL };
}

export async function nameReturnAngle(input: {
  request: ReturnAngleRequest;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<ReturnAngleResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: NAME_MATERIAL_MODEL,
      max_tokens: 512,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the section of the article this person should read next.',
          input_schema: {
            type: 'object',
            properties: {
              section: { type: ['string', 'null'] },
              basis: { type: 'string' },
            },
            required: ['section', 'basis'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME),
      messages: [{ role: 'user', content: describeReturn(input.request) }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return { ok: false, detail: 'Rate limited.' };
    return { ok: false, detail: error instanceof Error ? error.message : 'The naming call failed.' };
  }

  // Before the reply is read: a malformed report still cost what it cost.
  input.onSpend?.({ model: NAME_MATERIAL_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };
  return readAngle(block.input);
}

import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { MODELS } from '@/lib/core/models';

/**
 * Writing the case a level 4 to 6 cell is asked as (docs/LEARN-LEVELS-SPEC.md,
 * "Cases and defences"; plan #2138.8): a situation or some numbers, a task,
 * and the answer it expects. The case is written against the asked cell's
 * descriptor, so it asks for the doing the checks name.
 *
 * Haiku, as the grader is. The expected answer is stored with the question
 * and shown to the grader only, so a case is graded against a fixed result
 * and not against what the grader would have worked out that day.
 */

export const LEVEL_CASE_MODEL = MODELS.learnLevelCase;
const TOOL = 'report_case';

const SYSTEM = `You write one case for somebody to work, to see whether they can DO a thing and not only describe it.

The prompt gives a topic, a level from 4 to 6, and the checks that say what
meeting the level looks like.
- Level 4 is a clean, given case: every input is supplied and the work is
  applying the method.
- Level 5 is a real case: some inputs are missing or messy and they must
  choose them and say what they chose.
- Level 6 is a case with a trap or a judgement: the obvious method needs
  adapting, and they must see why.

THE CASE: the situation with its numbers or facts in two to five sentences,
then one task they answer in writing. Specific names and figures, not
placeholders. It must be answerable in a few lines without a source open.

DO NOT PUT THE ANSWER IN THE CASE, and do not name the method when naming it
would hand over the step they are being asked to find.

EXPECTED: the result you expect and the working that gets there, in two to
four sentences, standing on its own. For level 5 say which choices are
acceptable. It is shown to the grader and never to the person.`;

const caseSchema = z.object({
  question: z.string().trim().min(20).max(1_500),
  expected: z.string().trim().min(5).max(1_500),
});

export type WrittenCase = z.infer<typeof caseSchema>;
export type LevelCaseResult = { ok: true; case: WrittenCase } | { ok: false; detail: string };

export function casePrompt(input: {
  topicName: string;
  level: number;
  descriptor: readonly string[];
  asked: readonly string[];
  /**
   * The idea the case is about, when the topic is one idea on the claims
   * graph (a goal question, plan #2164.3) rather than a cell of a territory.
   */
  claim?: string;
}): string {
  const lines = [`Topic: ${input.topicName}`, `Level: ${input.level}`];
  if (input.claim) lines.push(`The idea: ${input.claim}`);
  lines.push('', 'The checks for this level:');
  for (const check of input.descriptor) lines.push(`- ${check}`);
  if (input.asked.length > 0) {
    lines.push('', 'Cases already asked on this level, so write a different one:');
    for (const q of input.asked) lines.push(`- ${q.slice(0, 200)}`);
  }
  lines.push('', `Call ${TOOL}.`);
  return lines.join('\n');
}

/** Write one case for a cell. Never throws. */
export async function writeLevelCase(input: {
  topicName: string;
  level: number;
  descriptor: readonly string[];
  asked?: readonly string[];
  claim?: string;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<LevelCaseResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  let response;
  try {
    response = await client.messages.create({
      model: LEVEL_CASE_MODEL,
      max_tokens: 900,
      system: SYSTEM,
      tools: [
        {
          name: TOOL,
          description: 'Report the case to work and the answer it expects.',
          input_schema: {
            type: 'object',
            properties: {
              question: { type: 'string', description: 'The situation and the task, as the person will read it.' },
              expected: { type: 'string', description: 'The expected result and working. Never shown to the person.' },
            },
            required: ['question', 'expected'],
          },
        },
      ],
      tool_choice: forceTool(TOOL, LEVEL_CASE_MODEL),
      messages: [{ role: 'user', content: casePrompt({ ...input, asked: input.asked ?? [] }) }],
    });
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'Writing a case failed.' };
  }
  input.onSpend?.({ model: LEVEL_CASE_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };
  const parsed = caseSchema.safeParse(block.input);
  if (!parsed.success) return { ok: false, detail: 'The case came back malformed.' };
  return { ok: true, case: parsed.data };
}

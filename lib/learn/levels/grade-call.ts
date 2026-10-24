import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { MODELS } from '@/lib/core/models';
import type { GraderCell, RawVerdict } from '@/lib/learn/levels/grade';
import { readReasoning, signalLines, withReasoningRule, type AnswerSignals } from '@/lib/learn/confidence';

/**
 * The grading call for an explanation (docs/LEARN-LEVELS-SPEC.md, "How
 * answers are graded"): one call reads the answer against the asked cell, the
 * cells two levels either side of it, and the cells it requires, and says
 * met, not met or not touched for each, with the words that meet it.
 *
 * Haiku, as every other grader in Learn is: the cells come in with their
 * checks written out, so the call matches an answer against a short list and
 * makes no judgment about a field. It is also the call a person waits on.
 *
 * What it returns is not what gets written. `applyGradeRules` in grade.ts
 * drops a met whose quote is not in the answer word for word and any not met
 * off the asked cell, so the prompt asks for both and the code holds to them.
 */

export const LEVEL_GRADE_MODEL = MODELS.learnLevelGrade;
export const LEVEL_GRADE_SECOND_MODEL = MODELS.learnLevelGradeSecond;
const TOOL = 'report_grades';

const CELL_SCOPE = `Each level is a cell with a key (C1, C2, ...), a topic, a level from 1 to 10,
and two to four checks saying what meeting it looks like. C1 is the cell the
question asked about. The others are the levels around it on the same topic
and the levels of other topics it rests on.`;

/** For a prompt about a whole course (plan #2172.4.2): no cell is the one asked about. */
const COURSE_SCOPE = `Each level is a cell with a key (C1, C2, ...), a topic, a level from 1 to 10,
and the checks saying what meeting it looks like. The question asked about a
whole course, and every cell is a level of a topic that course taught. The
answer will go to some topics and not others; grade each cell on what the
answer shows about that topic alone. Use not_met only where the answer wrote
about the topic and got it wrong or fell short of the level.`;

const system = (scope: 'cell' | 'course') => `You grade one written answer against several levels of understanding.

${scope === 'course' ? COURSE_SCOPE : CELL_SCOPE}

FOR EVERY CELL, SAY ONE OF THREE THINGS.
- met: the answer itself does what the checks describe. Not a mention of the
  words; the understanding the checks name, shown in what was written.
- not_met: the answer tried to do what the checks describe and got it wrong
  or fell short.
- not_touched: the answer does not go there. Most cells other than C1 will be
  this, and that is fine. Silence about something is not a failure of it.

FOR EVERY MET, COPY THE WORDS THAT MEET IT. The quote is a span of the answer
copied exactly, character for character: no paraphrase, no ellipsis, no
joining of two places. Choose the shortest span that shows the cell is met,
usually one sentence. A met whose quote is not in the answer is thrown away,
so if you cannot point at the words, it is not met.

BE STRICT ABOUT HIGHER LEVELS. Saying that something has limits is not naming
them; naming a formula is not explaining why each part is there. Give the
level the answer actually reaches.

Call ${TOOL} once, with one entry per cell.`;

const SYSTEM = system('cell');
const COURSE_SYSTEM = system('course');

/**
 * The system prompt with the reasoning rule after it, for an answer that came
 * with reasoning (plan #2522.3). Here a wrong answer is a not_met on C1, and
 * the reason is the sentence saying which part of the reasoning does not hold.
 */
export function gradeSystem(scope: 'cell' | 'course', reasoning: boolean): string {
  const base = scope === 'course' ? COURSE_SYSTEM : SYSTEM;
  if (!reasoning) return base;
  return `${withReasoningRule(base)}
Here, grading it wrong means not_met on C1, with no quote, and a reason that
names the part of the reasoning that does not hold.`;
}

const gradeSchema = z.object({
  grades: z.array(
    z.object({
      cell: z.string(),
      verdict: z.enum(['met', 'not_met', 'not_touched']),
      quote: z.string().nullish(),
      reason: z.string().nullish(),
    }),
  ),
});

export type LevelGradeResult =
  | { ok: true; verdicts: RawVerdict[] }
  | { ok: false; detail: string };

/** The prompt: each cell with its key and checks, then the question and the answer. */
export function gradePrompt(input: {
  cells: readonly GraderCell[];
  question: string;
  answer: string;
  expected?: string | null;
  /** A figure question's figure and answer, written out (plan #2321.5); graded on the asked cell alone. */
  figure?: string | null;
  /** How sure they were and how they reasoned, when given (plan #2522.3). */
  signals?: AnswerSignals | null;
}): string {
  const lines: string[] = ['The cells:', ''];
  for (const cell of input.cells) {
    const role =
      cell.role === 'asked'
        ? 'the cell asked about'
        : cell.role === 'nearby'
          ? 'same topic'
          : cell.role === 'course'
            ? 'a topic the course taught'
            : 'a level the asked cell rests on';
    lines.push(`${cell.key}: ${cell.topicName}, level ${cell.level} (${role})`);
    for (const check of cell.descriptor) lines.push(`  - ${check}`);
    lines.push('');
  }
  lines.push(`Question asked: ${input.question}`, '');
  if (input.expected) {
    lines.push(
      'The question is a case, and only C1 is graded. The answer it expects, which the person has not seen:',
      input.expected,
      '',
      'Grade C1 met when their answer reaches the same result by sound working, whatever the wording or the route.',
      'A different result, or the right result with no working shown, is not_met. Quote the working that meets it.',
      '',
    );
  }
  if (input.figure) {
    lines.push(
      'The question is asked on a figure, and only C1 is graded. The figure and the answer, which the person has not seen:',
      input.figure,
      '',
      'Grade C1 met when their answer gives the same thing as the answer, in any wording or notation; quote it.',
      'A different answer is not_met.',
      '',
    );
  }
  lines.push('Their answer:', input.answer, '');
  const extra = signalLines(input.signals);
  if (extra.length > 0) lines.push(...extra, '');
  lines.push(`Call ${TOOL}.`);
  return lines.join('\n');
}

/** Grade one explanation. Never throws. */
export async function gradeCellAnswer(input: {
  cells: readonly GraderCell[];
  question: string;
  answer: string;
  /** The answer a case expects; set for a case, which is graded on the asked cell alone. */
  expected?: string | null;
  /** A figure question's figure and answer, written out; graded on the asked cell alone. */
  figure?: string | null;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
  /** The model to grade with; the first grader's unless set. */
  model?: string;
  /** 'course' for a prompt about a whole course, whose cells are all its topics' levels (plan #2172.4.2). */
  scope?: 'cell' | 'course';
  /** How sure they were and how they reasoned, when given (plan #2522.3). */
  signals?: AnswerSignals | null;
}): Promise<LevelGradeResult> {
  const model = input.model ?? LEVEL_GRADE_MODEL;
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 400 + 200 * input.cells.length,
      system: gradeSystem(input.scope ?? 'cell', readReasoning(input.signals?.reasoning) !== null),
      tools: [
        {
          name: TOOL,
          description: 'Report met, not_met or not_touched for every cell, with the quote behind each met.',
          input_schema: {
            type: 'object',
            properties: {
              grades: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    cell: { type: 'string', description: 'The cell key, such as C1.' },
                    verdict: { type: 'string', enum: ['met', 'not_met', 'not_touched'] },
                    quote: {
                      type: 'string',
                      description: 'On a met only: the words of the answer that meet it, copied exactly.',
                    },
                    reason: { type: 'string', description: 'One short sentence on why this verdict.' },
                  },
                  required: ['cell', 'verdict'],
                },
              },
            },
            required: ['grades'],
          },
        },
      ],
      tool_choice: forceTool(TOOL, model),
      messages: [{ role: 'user', content: gradePrompt(input) }],
    });
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'Grading failed.' };
  }

  input.onSpend?.({ model, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };

  const parsed = gradeSchema.safeParse(block.input);
  if (!parsed.success) return { ok: false, detail: 'The grade came back malformed.' };

  return {
    ok: true,
    verdicts: parsed.data.grades.map((g) => ({ cell: g.cell, verdict: g.verdict, quote: g.quote ?? null, reason: g.reason ?? null })),
  };
}

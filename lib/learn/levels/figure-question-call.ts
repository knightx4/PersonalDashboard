import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { MODELS } from '@/lib/core/models';
import { figureQuestionOffers, figureQuestionWriterLines, type WrittenFigureQuestion } from '@/lib/learn/figures/question';

/**
 * Writing a figure question for a cell (plan #2321.5): a question that asks
 * somebody to use a figure rather than write a paragraph, against the asked
 * level's checks. The writer chooses a form from the registry's list, writes
 * the figure and the form's ask, or says none fits; the form then poses the
 * question and keeps the answer (lib/learn/figures/question.ts).
 *
 * Haiku, as the case writer is. Nothing the writer says is the answer to a
 * chart question: that is read from the fetched series.
 */

export const LEVEL_FIGURE_MODEL = MODELS.learnLevelCase;
const TOOL = 'report_figure_question';

const SYSTEM = `You write one question that asks somebody to USE a figure, to see whether they hold one level of a topic, instead of asking them to write a paragraph.

The prompt gives a topic, a level, the checks that say what meeting the level
looks like, and the forms of figure question there are, each with the shape of
its figure and of its ask.

Choose the form whose answer would show the checks are met. Write the figure
in full and the ask the form names. The figure must be true: only figures and
series you are sure of. Put nothing in the caption that gives the answer away;
the caption says what the figure is about, in one sentence.

If no form would test these checks, a question of definitions or of judgement
that a figure cannot carry, call ${TOOL} with "none": true. That is often the
right answer, and an explanation is asked instead.`;

const reportSchema = z.object({
  none: z.boolean().nullish(),
  kind: z.string().nullish(),
  form: z.string().nullish(),
  caption: z.string().nullish(),
  spec: z.unknown(),
  ask: z.unknown(),
});

export type FigureQuestionWriteResult =
  | { ok: true; written: WrittenFigureQuestion | null }
  | { ok: false; detail: string };

export function figureQuestionPrompt(input: {
  topicName: string;
  level: number;
  descriptor: readonly string[];
  asked: readonly string[];
}): string {
  const lines = [`Topic: ${input.topicName}`, `Level: ${input.level}`, '', 'The checks for this level:'];
  for (const check of input.descriptor) lines.push(`- ${check}`);
  lines.push('', 'The forms:', figureQuestionWriterLines());
  if (input.asked.length > 0) {
    lines.push('', 'Figure questions already asked on this level, so write a different one:');
    for (const q of input.asked) lines.push(`- ${q.slice(0, 200)}`);
  }
  lines.push('', `Call ${TOOL}.`);
  return lines.join('\n');
}

/** Write one figure question for a cell, or none when no form fits. Never throws. */
export async function writeFigureQuestion(input: {
  topicName: string;
  level: number;
  descriptor: readonly string[];
  asked?: readonly string[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<FigureQuestionWriteResult> {
  const offers = figureQuestionOffers();
  if (offers.length === 0) return { ok: true, written: null };
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  let response;
  try {
    response = await client.messages.create({
      model: LEVEL_FIGURE_MODEL,
      max_tokens: 1_500,
      system: SYSTEM,
      tools: [
        {
          name: TOOL,
          description: 'Report the figure question, or none when no form fits the level.',
          input_schema: {
            type: 'object',
            properties: {
              none: { type: 'boolean', description: 'True when no form would test these checks.' },
              kind: { type: 'string', enum: [...new Set(offers.map((offer) => offer.kind.id))] },
              form: { type: 'string', enum: [...new Set(offers.map((offer) => offer.form.id))] },
              caption: { type: 'string', description: 'One sentence on what the figure is about, without the answer.' },
              spec: { type: 'object', description: "The figure's spec, in its kind's shape." },
              ask: { type: 'object', description: "The form's ask, in its shape." },
            },
          },
        },
      ],
      tool_choice: forceTool(TOOL, LEVEL_FIGURE_MODEL),
      messages: [{ role: 'user', content: figureQuestionPrompt({ ...input, asked: input.asked ?? [] }) }],
    });
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'Writing a figure question failed.' };
  }
  input.onSpend?.({ model: LEVEL_FIGURE_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };
  const parsed = reportSchema.safeParse(block.input);
  if (!parsed.success) return { ok: false, detail: 'The figure question came back malformed.' };
  const report = parsed.data;
  if (report.none || !report.kind || !report.form) return { ok: true, written: null };
  return {
    ok: true,
    written: { kind: report.kind, form: report.form, caption: report.caption ?? '', spec: report.spec, ask: report.ask },
  };
}

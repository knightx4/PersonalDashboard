import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { THINKING_ROOM, forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { WRITE_LESSON_MODEL } from './write-lesson';
import { markAgainstPoints, type MarkedPoints } from './mark-points';
import type { HandIn } from './point-marks';
import {
  PROJECT_LIMITS,
  planLines,
  projectPayloadSchema,
  projectPrompt,
  toWrittenProject,
  type PlanForProject,
  type WrittenProject,
} from './project';

/**
 * Writing a plan's final project and marking what is handed in (plan #1146).
 * Sonnet writes the brief from the plan's outline, as it wrote the outline;
 * Haiku marks each hand-in point by point (`markAgainstPoints`), as a piece's
 * practice is marked.
 */

export const WRITE_PROJECT_MODEL = WRITE_LESSON_MODEL;
const TOOL = 'report_project';

const WRITE_SYSTEM = `You write the final project for a course. The person has worked, or is working,
through every unit listed. The project is one larger task that uses the whole
course together: for a course on SaaS metrics, working out a public SaaS
company's retention and CAC payback from a summary of its reported figures.
They hand it in by typing into a web page, and it is marked point by point.

A REAL CASE, WITH EVERYTHING NEEDED GIVEN. Set it on a realistic company,
decision or situation. Give the figures the work needs as a table (columns and
rows, at most ${PROJECT_LIMITS.columns} columns and ${PROJECT_LIMITS.rows}
rows), not buried in prose, so nothing has to be looked up. A real company's
name is fine when the figures are plausible for it; say they are illustrative.

ABOUT AN HOUR OR TWO OF WORK, doable with a calculator. It should draw on most
of the units, not only one, and end with a judgement or recommendation that
the figures support.

WHEN THE WORK ENDS IN NUMBERS, name the key figures to type in (figures), each
with a short label and its unit, at most ${PROJECT_LIMITS.figures}. Ask for
the working and the judgement as written text as well.

DO NOT PUT THE ANSWER IN THE BRIEF.

POINTS: four to ${PROJECT_LIMITS.points} things a complete hand-in has, each
checkable on its own: a figure and its value, a step, a judgement and the
reason for it. Every point must be met to pass. A point that checks a figure
states the expected value and, where rounding matters, how close counts.

WORKED: a worked answer that reaches every point. It is shown once they pass.

SPREADSHEET: when this work is normally done in a spreadsheet, such as a
financial model, still write a version that can be typed in, and say in
spreadsheet_note, in one sentence, what the typed version leaves out. Leave
spreadsheet_note empty otherwise.

TITLE: a short name for the project, a few words.

Write the brief to them, plainly, in a few short paragraphs.`;

export type WrittenProjectResult =
  | { outcome: 'ready'; project: WrittenProject }
  | { outcome: 'dropped'; reason: string }
  | { outcome: 'failed'; detail: string };

/** Write the final project for a plan. Never throws. */
export async function writeProject(input: {
  plan: PlanForProject;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<WrittenProjectResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: WRITE_PROJECT_MODEL,
      max_tokens: 4000 + THINKING_ROOM,
      system: WRITE_SYSTEM,
      tools: [
        {
          name: TOOL,
          description: 'Report the final project, what it is marked on and a worked answer.',
          input_schema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              task: { type: 'string' },
              columns: { type: 'array', items: { type: 'string' } },
              rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
              figures: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { label: { type: 'string' }, unit: { type: 'string' } },
                  required: ['label'],
                },
              },
              points: { type: 'array', items: { type: 'string' } },
              worked: { type: 'string' },
              spreadsheet_note: { type: 'string' },
            },
            required: ['title', 'task', 'points', 'worked'],
          },
        },
      ],
      tool_choice: forceTool(TOOL, WRITE_PROJECT_MODEL),
      messages: [{ role: 'user', content: projectPrompt(input.plan, TOOL) }],
    });
  } catch (error) {
    return { outcome: 'failed', detail: error instanceof Error ? error.message : 'Writing the project failed.' };
  }

  input.onSpend?.({ model: WRITE_PROJECT_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL);
  if (!block || block.type !== 'tool_use') return { outcome: 'failed', detail: whyNoReport(response) };

  const safe = projectPayloadSchema.safeParse(block.input);
  if (!safe.success) return { outcome: 'failed', detail: 'The project came back malformed.' };

  const checked = toWrittenProject(safe.data);
  return checked.ok ? { outcome: 'ready', project: checked.project } : { outcome: 'dropped', reason: checked.reason };
}

/** Mark one hand-in for a plan's final project. Never throws. */
export function markProject(input: {
  plan: PlanForProject;
  task: string;
  points: readonly string[];
  worked: string;
  handIn: HandIn;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<MarkedPoints> {
  return markAgainstPoints({
    context: ['This is the final project of a course.', ...planLines(input.plan, 'titles')],
    task: input.task,
    points: input.points,
    reference: input.worked,
    handIn: input.handIn,
    anthropicApiKey: input.anthropicApiKey,
    client: input.client,
    onSpend: input.onSpend,
  });
}

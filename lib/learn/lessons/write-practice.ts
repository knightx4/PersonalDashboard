import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { THINKING_ROOM, forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { WRITE_LESSON_MODEL } from './write-lesson';
import { markAgainstPoints, type MarkedPoints } from './mark-points';
import { pieceLines, type PieceForCheck } from './piece-check';
import type { HandIn } from './point-marks';
import {
  MAX_COLUMNS,
  MAX_FIGURES,
  MAX_ROWS,
  practicePayloadSchema,
  practicePrompt,
  toWrittenPractice,
  type LessonForPractice,
  type WrittenPractice,
} from './practice';

/**
 * Writing a piece's practice task and marking what is handed in (plan #1142).
 * Sonnet writes the task, as it writes the piece's lessons; Haiku marks each
 * hand-in point by point (`markAgainstPoints`), as teach-backs are marked.
 */

export const WRITE_PRACTICE_MODEL = WRITE_LESSON_MODEL;
const TOOL = 'report_practice';

const WRITE_SYSTEM = `You write one practice task for one piece of a course. The person has just read
the piece's lessons. The task has them do the thing the piece teaches: work
out a figure from a small table, lay out a grid or a bridge, or apply the
ideas to a short case. They hand it in by typing into a web page, and it is
marked point by point.

DOABLE IN THE PAGE IN ABOUT TEN MINUTES, WITH NOTHING LOOKED UP. Give any
numbers the task needs as a small table (columns and rows, at most
${MAX_COLUMNS} columns and ${MAX_ROWS} rows), not buried in prose. Keep the
numbers easy enough to work by hand or with a calculator.

WHEN THE WORK ENDS IN NUMBERS, name the key figures to type in (figures), each
with a short label and its unit, at most ${MAX_FIGURES}. Ask for working as
well when the steps matter. When the work ends in words or a layout, ask for it
as lines of text and name no figures.

THE TASK MUST USE THE PIECE'S IDEAS. A task one line of arithmetic answers
without them is too thin.

DO NOT PUT THE ANSWER IN THE TASK.

POINTS: two to six things a complete hand-in has, each checkable on
its own: a figure and its value, a step, a reason. Every point must be met to
pass. A point that checks a figure states the expected value and, where
rounding matters, how close counts.

WORKED: a short worked answer that reaches every point. It is shown once they
pass.

SPREADSHEET: when this skill is normally done in a spreadsheet, such as a
financial model or a revenue bridge across many cells, still write a version
that can be typed in, and say in spreadsheet_note, in one sentence, what the
typed version leaves out. Leave spreadsheet_note empty otherwise.

Write the task to them, plainly, in a few sentences.`;

export type WrittenPracticeResult =
  | { outcome: 'ready'; practice: WrittenPractice }
  | { outcome: 'dropped'; reason: string }
  | { outcome: 'failed'; detail: string };

/** Write the practice task for a piece. Never throws. */
export async function writePractice(input: {
  piece: PieceForCheck;
  lessons: readonly LessonForPractice[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<WrittenPracticeResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: WRITE_PRACTICE_MODEL,
      max_tokens: 3000 + THINKING_ROOM,
      system: WRITE_SYSTEM,
      tools: [
        {
          name: TOOL,
          description: 'Report the practice task, what it is marked on and a worked answer.',
          input_schema: {
            type: 'object',
            properties: {
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
            required: ['task', 'points', 'worked'],
          },
        },
      ],
      tool_choice: forceTool(TOOL, WRITE_PRACTICE_MODEL),
      messages: [{ role: 'user', content: practicePrompt(input.piece, input.lessons, TOOL) }],
    });
  } catch (error) {
    return { outcome: 'failed', detail: error instanceof Error ? error.message : 'Writing the task failed.' };
  }

  input.onSpend?.({ model: WRITE_PRACTICE_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL);
  if (!block || block.type !== 'tool_use') return { outcome: 'failed', detail: whyNoReport(response) };

  const safe = practicePayloadSchema.safeParse(block.input);
  if (!safe.success) return { outcome: 'failed', detail: 'The task came back malformed.' };

  const checked = toWrittenPractice(safe.data);
  return checked.ok ? { outcome: 'ready', practice: checked.practice } : { outcome: 'dropped', reason: checked.reason };
}

/** Mark one hand-in for a piece's practice. Never throws. */
export function markPractice(input: {
  piece: PieceForCheck;
  task: string;
  points: readonly string[];
  worked: string;
  handIn: HandIn;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<MarkedPoints> {
  return markAgainstPoints({
    context: pieceLines(input.piece),
    task: input.task,
    points: input.points,
    reference: input.worked,
    handIn: input.handIn,
    anthropicApiKey: input.anthropicApiKey,
    client: input.client,
    onSpend: input.onSpend,
  });
}

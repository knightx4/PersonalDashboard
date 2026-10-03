import type Anthropic from '@anthropic-ai/sdk';
import { CAPTURE_MOVE_TOOLS } from '@/lib/goals/capture';
import type { DashTool, DashWriteTool } from './registry';

/**
 * The five moves "Log what happened" files a sentence as (plan #1478,
 * feature #1477; docs/CORE-AND-DASH-SPEC.md, Part 6), as write tools in the
 * registry: close a step, count towards a rhythm, log progress, record a
 * reading of a goal's number, add a step.
 *
 * Each names the goals and steps by the short refs (g1, s4) the capture
 * message shows, never by id, and each is checked against what was shown by
 * parseMove in lib/goals/capture.ts before anything is written. What a move
 * does is carried out by the capture box (lib/goals/capture-model.ts, which
 * hands it to fileCapture), and each line it files is recorded in
 * core.dash_actions with surface 'capture' and an Undo
 * (lib/goals/capture-store.ts).
 *
 * They belong to a capture, `goals.captures`, the way a thread's own tools
 * belong to its row: offered only where the conversation hangs from a
 * capture, so never in Ask or on a thread. A write here calls the acts the
 * capture binds (`DashWriteContext.thread`), and refuses anywhere else.
 */

/** The table a capture is kept in, which these tools belong to. */
export const CAPTURE_TABLE = 'goals.captures';

const CAPTURE_ONLY = 'That can only be done from the capture box. Answer in words.';

type Schema = Anthropic.Tool['input_schema'];

function move(name: string, description: string, properties: Schema['properties'], required: string[]): DashWriteTool {
  return {
    name,
    kind: 'write',
    subjects: [CAPTURE_TABLE],
    definition: {
      name,
      description,
      input_schema: { type: 'object', properties, required, additionalProperties: false },
    },
    apply: async (ctx, input) => (ctx.thread ? ctx.thread(name, input) : { ok: false, error: CAPTURE_ONLY }),
  };
}

const STEP = { type: 'string', description: 'The step, by its ref such as s4.' } as const;
const GOAL = { type: 'string', description: 'The goal, by its ref such as g1.' } as const;
const DAY = {
  type: 'string',
  description:
    'YYYY-MM-DD, only when the sentence names another day than today, such as yesterday; work it out from today\'s date.',
} as const;
const TEXT = {
  type: 'string',
  description: "What was done, in a short phrase in the person's own terms, with no quotation marks.",
} as const;
const QUANTITY = {
  type: 'number',
  description: 'The amount alone, when the sentence gives one ("moved two bags" is 2).',
} as const;
const UNIT = { type: 'string', description: 'What was counted, such as bags, pages or rooms. Only with a quantity.' } as const;
const TOTAL = {
  type: 'number',
  description:
    'How many there are in all, in the same unit. Only for a step shown with "no total" whose done-when or what Dash prepared says the number, or when the sentence says it. Never guess one.',
} as const;

/** The capture tools, in the order the model is sent them. */
export const CAPTURE_TOOLS: readonly DashTool[] = [
  move(
    CAPTURE_MOVE_TOOLS.close,
    'The whole of a step is finished. Only for steps marked mine or claude, never a rhythm. Part of a step\'s work is progress, never a close.',
    { step: STEP },
    ['step'],
  ),
  move(
    CAPTURE_MOVE_TOOLS.count,
    'The sentence reports occurrences of a rhythm step, such as "went to an event" against a rhythm of one event a week. Only for steps marked rhythm with a period open.',
    {
      step: STEP,
      quantity: {
        type: 'integer',
        description: 'How many, when the sentence says more than one ("sent three applications" is 3). Leave it out for one.',
      },
      day: DAY,
    },
    ['step'],
  ),
  move(
    CAPTURE_MOVE_TOOLS.progress,
    'Part of the work, done without finishing it. Name the deepest step the sentence fits; when no step fits, give the goal instead, but only when the work belongs to the goal as a whole. A distinct piece of work the tree has no step for is an add carrying the progress.',
    { step: STEP, goal: GOAL, text: TEXT, quantity: QUANTITY, unit: UNIT, day: DAY, total: TOTAL },
    ['text'],
  ),
  move(
    CAPTURE_MOVE_TOOLS.reading,
    'The sentence gives the current value of a goal\'s number, such as a balance or a weight. Only for goals marked "measured in".',
    { goal: GOAL, value: { type: 'number', description: "The number alone, in the goal's unit." } },
    ['goal', 'value'],
  ),
  move(
    CAPTURE_MOVE_TOOLS.add,
    'A follow-up step the sentence implies, or work already done on something no step covers. For work already done, add the step under the nearest step it fits (or the goal) and give text, quantity, unit and day as for progress, so it starts under way; never also log the same work as a separate progress move.',
    {
      parent: { type: 'string', description: 'The goal or step it goes under, by its ref (g1 or s4).' },
      title: { type: 'string', description: 'What will be done, in a few plain words, with no quotation marks.' },
      kind: {
        type: 'string',
        enum: ['mine', 'claude'],
        description:
          'mine when the person does it; claude when it is research or drafting Dash can do later, such as finding a sign-up page, a contact or an application form.',
      },
      text: TEXT,
      quantity: QUANTITY,
      unit: UNIT,
      day: DAY,
      total: TOTAL,
    },
    ['parent', 'title', 'kind'],
  ),
];

export const CAPTURE_TOOL_NAMES = CAPTURE_TOOLS.map((t) => t.name);

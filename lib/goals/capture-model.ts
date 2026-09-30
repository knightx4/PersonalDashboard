/**
 * The model call behind the capture box (plan #929): one sentence read
 * against your open goals and steps, answered through a single tool.
 *
 * Haiku, with a forced tool call and nothing else, because the box has to
 * answer in seconds, the same fast path as Dash's replies to comments
 * (lib/comments/reply.ts). The rules for what the answer may do are in
 * lib/goals/capture.ts, which checks every ref before anything is written.
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import type { AskResult } from '@/lib/goals/capture';

export const CAPTURE_MODEL = 'claude-haiku-4-5';
const TOOL_NAME = 'file';

const SYSTEM = `You file a sentence the owner of a personal goals tracker wrote
about something that happened. You are given their open goals, each with a ref
like g1, and the open steps under each goal, each with a ref like s4, then the
sentence. A step may have a line in brackets under it with its done-when, its
total and how much is logged so far, and what Dash prepared for it.

Decide what the sentence means for those goals, using only these five moves:

- close: the whole of a step is finished. "step" is its ref. Only for steps
  marked mine or claude, never a rhythm.
- count: the sentence reports occurrences of a rhythm step (for example "went
  to an event" against a rhythm of one event a week). "step" is its ref. Only
  for steps marked rhythm with a period open. "quantity" is how many, as a
  whole number, when the sentence says more than one ("sent three
  applications" is quantity 3); leave it out for one. "day" is the date as
  YYYY-MM-DD, only when the sentence names another day than today, such as
  yesterday; work it out from today's date.
- progress: part of the work, done without finishing it. "step" is the ref of
  the deepest step the sentence fits; when no step fits, leave "step" out and
  give "goal" instead, but only when the work belongs to the goal as a whole;
  a distinct piece of work the tree has no step for is an add carrying the
  progress, below. "text" says what was done in a short phrase in the
  person's own terms. When the sentence gives an amount, "quantity" is the
  number alone and "unit" is what was counted, such as bags, pages or rooms
  ("moved two bags" is quantity 2, unit bags). "day" is the date it happened
  as YYYY-MM-DD, only when the sentence names another day than today, such as
  yesterday; work it out from today's date.
  "total" is how many there are in all, in the same unit, and only for a
  step shown with "no total" whose done-when or what Dash prepared for it
  says the number ("all 100 bags", "about 100 bags"). Never guess one.
- reading: the sentence gives the current value of a goal's number, such as a
  balance or a weight. "goal" is its ref and "value" is the number alone, in
  the goal's unit. Only for goals marked "measured in".
- add: a follow-up step the sentence implies. "parent" is the ref of the goal
  or step it goes under, "title" says what will be done in a few plain words,
  and "kind" is mine when the person does it or claude when it is research or
  drafting Claude can do later, such as finding a sign-up page, a contact or
  an application form.
  When the sentence reports work already done on something no step covers,
  add that step under the nearest step it fits (or the goal) and log the work
  on it in the same move: "text", "quantity", "unit" and "day" as for
  progress, so the step starts under way. "moved two bags to the office" with
  only a "Living room" step is an add under it titled "Move the bags to the
  office", text "moved two bags", quantity 2, unit bags. "total" only when the
  sentence says how many there are in all. Never also log the same work as a
  separate progress move.

Rules:

- One sentence can touch several goals. File against each that it plainly
  concerns, and against none that it does not.
- Prefer a move on an existing step over adding a new one.
- A sentence reporting part of a step's work (some of the bags, one of
  several rooms, two chapters of a book) is progress on that step, never a
  close. Close a step only when the sentence says the whole step is finished.
  When unsure, log progress: the step stays open and nothing is lost.
- Never invent refs. If nothing fits, return an empty list: the sentence is
  kept either way.
- Titles and progress text are short and plain, with no quotation marks around them.`;

export type CaptureModelOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Anthropic;
  /** What the call cost; recorded as 'file-capture'. */
  onSpend?: SpendSink;
};

/** Ask; get back the tool input, or why there is none. */
export async function askCaptureModel(
  options: CaptureModelOptions,
  message: string,
): Promise<AskResult> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });

  let response;
  try {
    response = await client.messages.create({
      model: CAPTURE_MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'File the sentence against the goals and steps as a list of moves.',
          input_schema: {
            type: 'object',
            properties: {
              actions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    type: {
                      type: 'string',
                      enum: ['close', 'count', 'progress', 'reading', 'add'],
                    },
                    step: { type: ['string', 'null'] },
                    goal: { type: ['string', 'null'] },
                    parent: { type: ['string', 'null'] },
                    title: { type: ['string', 'null'] },
                    kind: { type: ['string', 'null'], enum: ['mine', 'claude', null] },
                    text: { type: ['string', 'null'] },
                    value: { type: ['number', 'null'] },
                    quantity: { type: ['number', 'null'] },
                    unit: { type: ['string', 'null'] },
                    day: { type: ['string', 'null'] },
                    total: { type: ['number', 'null'] },
                  },
                  required: ['type'],
                },
              },
            },
            required: ['actions'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [{ role: 'user', content: message }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'Filing is rate-limited right now.' };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, error: `Filing failed (${error.status}).` };
    }
    return { ok: false, error: 'Filing failed.' };
  }
  options.onSpend?.({ model: CAPTURE_MODEL, usage: usageFrom(response.usage) });

  const reported = response.content.find(
    (block) => block.type === 'tool_use' && block.name === TOOL_NAME,
  );
  if (!reported || reported.type !== 'tool_use') return { ok: false, error: 'Nothing came back.' };
  return { ok: true, input: reported.input };
}

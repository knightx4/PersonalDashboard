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
sentence.

Decide what the sentence means for those goals, using only these four moves:

- close: a step is finished. "step" is its ref. Only for steps marked mine or
  claude, never a rhythm.
- count: the sentence is one occurrence of a rhythm step (for example "went
  to an event" against a rhythm of one event a week). "step" is its ref. Only
  for steps marked rhythm with a period open.
- note: progress towards a goal that no step captures, in a short phrase in
  the person's own terms. "goal" is its ref and "text" is the note.
- add: a follow-up step the sentence implies. "parent" is the ref of the goal
  or step it goes under, "title" says what will be done in a few plain words,
  and "kind" is mine when the person does it or claude when it is research or
  drafting Claude can do later, such as finding a sign-up page, a contact or
  an application form.

Rules:

- One sentence can touch several goals. File against each that it plainly
  concerns, and against none that it does not.
- Prefer a move on an existing step over adding a new one.
- Do not close a step unless the sentence says it is done.
- Never invent refs. If nothing fits, return an empty list: the sentence is
  kept either way.
- Titles and notes are short and plain, with no quotation marks around them.`;

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
                    type: { type: 'string', enum: ['close', 'count', 'note', 'add'] },
                    step: { type: ['string', 'null'] },
                    goal: { type: ['string', 'null'] },
                    parent: { type: ['string', 'null'] },
                    title: { type: ['string', 'null'] },
                    kind: { type: ['string', 'null'], enum: ['mine', 'claude', null] },
                    text: { type: ['string', 'null'] },
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

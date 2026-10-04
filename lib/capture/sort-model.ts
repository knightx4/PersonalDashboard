/**
 * The Haiku call that sorts a typed capture (plan #1580): one sentence, the
 * places this account can file into, the names of its goals and roles, and
 * back comes where each thing the sentence says belongs and how sure the
 * model is. The checking is lib/capture/sort.ts, so it is tested without a
 * model.
 *
 * One call, forced through one tool, with nothing to look up, because the box
 * shows the answer while the person is still typing.
 */
import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { DASH_MODELS } from '@/lib/dash/models';
import { forceTool } from '@/lib/learn/graph/tool-call';
import {
  MAX_CAPTURE_PARTS,
  captureSortMessage,
  readCaptureSortReply,
  type CaptureSort,
  type CaptureSortContext,
} from '@/lib/capture/sort';

export const CAPTURE_SORT_MODEL = DASH_MODELS.captureSort;
export const CAPTURE_SORT_TOOL = 'sort_capture';

const SYSTEM = `You sort what the owner of a personal dashboard typed into its
capture box. You are given the places it can go, each with what it is for,
their goals by ref (g1, g2) and the jobs they are applying for by ref (r1, r2),
then what they typed. It may be a note to themselves or a text message they
pasted in.

Report through ${CAPTURE_SORT_TOOL}:

- parts: one for each thing it says, with the place, the words that belong
  there, and for goals the goal_ref, for jobs the role_ref. Most sentences say
  one thing and get one part. Split only when it plainly says two or more
  things that belong in different places, at most ${MAX_CAPTURE_PARTS}.
- confidence: from 0 to 1, how sure you are that every part is in the right
  place and names the right goal or role. Under 0.8 when it could reasonably go
  in two places, when the goal or role it means is unclear, or when it is too
  short to tell.

Use only the places and refs you were given; never invent a ref. Keep each
part's words as they were typed.`;

/** The tool, with the place enum narrowed to what this account is offered. */
function sortTool(context: CaptureSortContext): Anthropic.Tool {
  return {
    name: CAPTURE_SORT_TOOL,
    description: 'Report where what they typed belongs.',
    input_schema: {
      type: 'object',
      properties: {
        parts: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_CAPTURE_PARTS,
          items: {
            type: 'object',
            properties: {
              place: { type: 'string', enum: [...context.places] },
              text: { type: 'string', description: 'The words that belong in this place, as typed.' },
              goal_ref: { type: 'string', description: 'For goals: the ref of the goal, such as g2.' },
              role_ref: { type: 'string', description: 'For jobs: the ref of the role, such as r1.' },
            },
            required: ['place', 'text'],
          },
        },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['parts', 'confidence'],
    },
  };
}

export type CaptureSortOptions = {
  client: Pick<Anthropic, 'messages'>;
  /** What the call cost; the caller records it under its paid key. */
  onSpend?: SpendSink;
  signal?: AbortSignal;
};

/**
 * The model's reply as it came, the tool input before any checking: what the
 * fixtures record (scripts/record-capture-sort.ts). Null when the call failed
 * or gave no tool block. Never throws.
 */
export async function requestCaptureSort(
  sentence: string,
  context: CaptureSortContext,
  options: CaptureSortOptions,
): Promise<unknown | null> {
  try {
    const response = await options.client.messages.create(
      {
        model: CAPTURE_SORT_MODEL,
        max_tokens: 400,
        system: SYSTEM,
        tools: [sortTool(context)],
        tool_choice: forceTool(CAPTURE_SORT_TOOL),
        messages: [{ role: 'user', content: captureSortMessage(sentence, context) }],
      },
      options.signal ? { signal: options.signal } : undefined,
    );
    options.onSpend?.({ model: CAPTURE_SORT_MODEL, usage: usageFrom(response.usage) });
    const block = response.content.find((part) => part.type === 'tool_use' && part.name === CAPTURE_SORT_TOOL);
    return block && block.type === 'tool_use' ? block.input : null;
  } catch (error) {
    console.error('capture sort failed', error);
    return null;
  }
}

/**
 * Sort one sentence. Null when there was nothing to sort (no place offered,
 * nothing typed) or the call failed; the box then offers the places as chips,
 * the same as an unsure sort. Never throws.
 */
export async function sortCapture(
  sentence: string,
  context: CaptureSortContext,
  options: CaptureSortOptions,
): Promise<CaptureSort | null> {
  if (context.places.length === 0 || !sentence.trim()) return null;
  const reply = await requestCaptureSort(sentence, context, options);
  return reply === null ? null : readCaptureSortReply(reply, sentence, context);
}

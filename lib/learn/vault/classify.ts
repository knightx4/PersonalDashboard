import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import {
  classifyPayloadSchema,
  sampleFor,
  tooShortToRead,
  type NoteClass,
} from '@/lib/learn/vault/classify-payload';

/**
 * What kind of note this is, in one cheap call.
 *
 * Haiku, a sample rather than the whole note, and one word back. This runs
 * once per note over the whole vault, so it is the pass whose unit cost
 * actually matters: everything downstream only sees what this lets through.
 */

const MODEL = 'claude-haiku-4-5';
const TOOL_NAME = 'classify_note';

const SYSTEM = `You sort personal notes into four kinds, so that only the ones
worth reading closely are read closely.

knowledge — argues something. States what is true, why it works, what follows
from it, or what somebody should do and why. A book's argument written down, a
course boiled down to its takeaways, an opinion with reasons attached.

mixed — carries an argument inside something else. A note about a conversation
that also states a position. Application prose that argues a thesis. Meeting
notes where somebody's reasoning was written down.

evidence — describes what a person has done, studied or can do, without
arguing a position. Transcripts, course lists, CVs, applications describing
experience, reading lists.

operational — logistics and records. Travel plans, contact details, meeting
times, task lists, dated logs of measurements, drafts with nothing stated yet.

Judge the prose in front of you rather than the title or the file path. A note
filed under somebody's name can still argue something, and a note filed under a
subject can still be a dosage log.

Where it genuinely sits between two, choose the one that decides correctly what
happens next: knowledge and mixed are read for claims, evidence and operational
are not.

Give one short sentence of reason. It is shown to the person, who can disagree
with it.`;

export type ClassifyResult = {
  noteClass: NoteClass;
  reason: string;
};

export async function classifyNote(input: {
  title: string;
  body: string;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<ClassifyResult> {
  // Answered without a call. See MIN_BODY_CHARS: most of the vault's short
  // notes are a line that meant something at the time, and paying to be told
  // so once per note is the easiest saving in the pass.
  if (tooShortToRead(input.body)) {
    return { noteClass: 'operational', reason: 'Too short to be stating a claim.' };
  }

  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: SYSTEM,
    tools: [
      {
        name: TOOL_NAME,
        description: 'Say what kind of note this is.',
        input_schema: {
          type: 'object',
          properties: {
            class: {
              type: 'string',
              enum: ['knowledge', 'mixed', 'evidence', 'operational'],
            },
            reason: { type: 'string' },
          },
          required: ['class', 'reason'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [
      {
        role: 'user',
        content: [`Title: ${input.title}`, '', sampleFor(input.body)].join('\n'),
      },
    ],
  });

  input.onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
  const parsed =
    block && block.type === 'tool_use' ? classifyPayloadSchema.safeParse(block.input) : null;

  // A classifier that fails reads as operational rather than as knowledge. The
  // cost of wrongly skipping a note is that it is not read this time; the cost
  // of wrongly reading one is junk in the graph, which somebody has to remove.
  if (!parsed?.success) {
    return { noteClass: 'operational', reason: 'Could not be classified.' };
  }

  return { noteClass: parsed.data.class, reason: parsed.data.reason };
}

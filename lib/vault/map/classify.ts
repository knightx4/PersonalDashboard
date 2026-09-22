import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { sampleFor } from '@/lib/learn/vault/classify-payload';
import { forceTool } from '@/lib/learn/graph/tool-call';
import { mapClassifySchema, tooShortForMap, type MapVerdict } from '@/lib/vault/map/rules';

/**
 * Stage 0 for the map: whether a note argues anything, in one cheap call.
 *
 * The same job as lib/learn/vault/classify.ts with the 75-note trial's two
 * fixes. There are three classes, and "evidence" is a flag beside them,
 * because a course summary or an application can evidence what somebody was
 * taught and still argue a position of their own. And the floor is 80
 * characters rather than 200. Only the title and the opening of the body are
 * sent; never the path.
 */

const MODEL = 'claude-haiku-4-5';
const TOOL_NAME = 'classify_note';

const SYSTEM = `You sort personal notes so that only the ones worth reading
closely are read closely.

knowledge: argues something. States what is true, why it works, what follows
from it, or what somebody should do and why. A book's argument written down, a
course boiled down to its takeaways, an opinion with reasons attached, or one
sentence stating a view plainly.

mixed: carries an argument inside something else. A note about a conversation
that also states a position. Application prose that argues a thesis. Meeting
notes where somebody's reasoning was written down.

operational: logistics and records with nothing argued. Travel plans, contact
details, meeting times, task lists, dated logs of measurements, drafts with
nothing stated yet.

Separately, say whether the note is evidence: it describes what a person has
done, studied or can do, such as coursework, a transcript, a CV or an
application. Evidence is not a class. A note can be evidence and knowledge at
once, and when it argues anything, choose knowledge or mixed.

Judge the prose in front of you rather than the title. Where a note sits
between two classes, choose the one that decides correctly what happens next:
knowledge and mixed are read, operational is not.

Give one short sentence of reason. It is shown to the person, who can disagree
with it.`;

export async function classifyForMap(input: {
  title: string;
  body: string;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<MapVerdict> {
  if (tooShortForMap(input.body)) {
    return {
      noteClass: 'operational',
      isEvidence: false,
      reason: 'Too short to be stating anything.',
    };
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
            class: { type: 'string', enum: ['knowledge', 'mixed', 'operational'] },
            is_evidence: { type: 'boolean' },
            reason: { type: 'string' },
          },
          required: ['class', 'is_evidence', 'reason'],
        },
      },
    ],
    tool_choice: forceTool(TOOL_NAME),
    messages: [
      { role: 'user', content: [`Title: ${input.title}`, '', sampleFor(input.body)].join('\n') },
    ],
  });

  input.onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find(
    (part) => part.type === 'tool_use' && part.name === TOOL_NAME,
  );
  const parsed =
    block && block.type === 'tool_use' ? mapClassifySchema.safeParse(block.input) : null;

  // A failed call reads as operational. Wrongly skipping a note costs one
  // reading; wrongly reading one puts junk in front of the person.
  if (!parsed?.success) {
    return { noteClass: 'operational', isEvidence: false, reason: 'Could not be classified.' };
  }

  return {
    noteClass: parsed.data.class,
    isEvidence: parsed.data.is_evidence,
    reason: parsed.data.reason,
  };
}

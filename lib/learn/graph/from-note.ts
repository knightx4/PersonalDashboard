import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import {
  noteChainPayloadSchema,
  normaliseChain,
  whyMalformed,
  type ExistingConcept,
  type ProposedChain,
} from '@/lib/learn/graph/chain-payload';
import { KIND_RULE, KIND_TOOL_FIELD } from '@/lib/learn/graph/kind-prompt';
import { MASTERY_RULE, MASTERY_TOOL_FIELD } from '@/lib/learn/graph/mastery-prompt';
import { NODE_RULE } from '@/lib/learn/graph/position-prompt';
import { MODELS } from '@/lib/core/models';

/**
 * What a reading actually taught, read out of the note you already wrote.
 *
 * Growth trigger 4, and the half of the join that costs the reader nothing.
 * The note is written anyway -- it is the one thing this application already
 * stores about what somebody learned rather than what they did -- and this
 * reads concepts out of it rather than asking for anything new.
 *
 * Haiku, because this is extraction rather than judgment: the note says what
 * it says, and the work is turning "so the point is that the rate only bites
 * through expectations" into a claim with a name, not deciding whether it is
 * true.
 *
 * Proposed, never added. A note is a rough thing written for yourself at the
 * end of a reading, and a good half of what a model finds in one is phrasing
 * rather than concepts. Approval is what stops the graph filling with
 * paraphrases of your own shorthand.
 */

const MODEL = MODELS.learnGraphFromNote;
const TOOL_NAME = 'report_chain';

const SYSTEM = `Somebody finished a reading and wrote a note about it. Pull out the
concepts the reading actually introduced, so they can be added to a graph of
what they know.

${NODE_RULE}

IN THE NOTE'S TERMS. State each one in the words the note uses. "A policy rate
only reaches prices through what people expect it to do next" is a concept;
"Monetary policy" is a subject heading and does not belong in this graph.

FEW. Zero to four. A reading introduces a couple of ideas and reminds you of a
dozen; only the introduced ones count. Zero is usually right for a note that
only records what happened: what they read, what the author did, what the
numbers were, what they thought of it. Do not stretch a thin note into one
concept to have something to return. Return an empty concepts list and set
too_vague true.

SEPARATING QUESTION AND COST. Each concept states the question that somebody
who holds it answers differently from somebody who does not
(separating_question), and what being wrong about it would cost
(cost_if_wrong): a decision made badly, a prediction that fails, a mistake in a
calculation, in a sentence that names it. "It is useful to know" is not a cost.
If you cannot name one, the concept fails the second test above: leave it out.

EDGES. Join them to each other where one rests on the other, and to the
concepts the subject already holds -- you are given those by name -- so each
new node is attached to something. Nothing goes in the graph without an edge.

DO NOT REPROPOSE what the subject already has. Name it exactly as given and
draw the edge instead.

${MASTERY_RULE}

${KIND_RULE}

BASIS. Each node and edge says how you know it belongs, in one short sentence.
Here that sentence is usually "taken from the note on <the reading>", and
saying so plainly is better than dressing it up: it is a weaker basis than a
syllabus and the screen should be able to say so.

IF THE NOTE INTRODUCES NOTHING -- it is a reaction, a to-do, a reminder that
this was boring -- set too_vague true and return nothing.`;

export type FromNoteResult =
  | { ok: true; chain: ProposedChain }
  | { ok: false; reason: 'nothing-in-it' | 'error'; detail: string };

export async function conceptsFromNote(input: {
  subject: string;
  readingTitle: string;
  note: string;
  existing: ExistingConcept[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<FromNoteResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  const lines = [
    `Subject: ${input.subject}`,
    '',
    `They read: ${input.readingTitle}`,
    '',
    'Their note:',
    input.note,
  ];
  if (input.existing.length > 0) {
    lines.push(
      '',
      'Concepts this subject already holds — name these exactly as written rather than restating them:',
      ...input.existing.map((concept) => `- ${concept.name}`),
    );
  }
  lines.push(
    '',
    `Call ${TOOL_NAME}, with goal_concept set to whichever concept the note is most about, or concepts empty when it introduces none.`,
  );

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the concepts this note introduced.',
          input_schema: {
            type: 'object',
            properties: {
              subject: { type: 'string' },
              goal_concept: { type: 'string' },
              too_vague: { type: 'boolean' },
              concepts: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    claim: { type: 'string' },
                    basis: { type: 'string' },
                    separating_question: {
                      type: 'string',
                      description:
                        'A question somebody who holds this answers differently from somebody who does not.',
                    },
                    cost_if_wrong: {
                      type: 'string',
                      description:
                        'What being wrong about this would cost, concretely. Leave the concept out if there is none.',
                    },
                    mastery: MASTERY_TOOL_FIELD,
                    kind: KIND_TOOL_FIELD,
                  },
                  required: [
                    'name',
                    'claim',
                    'basis',
                    'separating_question',
                    'cost_if_wrong',
                    'mastery',
                    'kind',
                  ],
                },
              },
              edges: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    prerequisite: { type: 'string' },
                    dependent: { type: 'string' },
                    basis: { type: 'string' },
                  },
                  required: ['prerequisite', 'dependent', 'basis'],
                },
              },
            },
            required: ['subject', 'concepts', 'edges'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME),
      messages: [{ role: 'user', content: lines.join('\n') }],
    });
  } catch (error) {
    return {
      ok: false,
      reason: 'error',
      detail: error instanceof Error ? error.message : 'Reading the note failed.',
    };
  }

  input.onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') {
    return { ok: false, reason: 'error', detail: whyNoReport(response) };
  }

  const safe = noteChainPayloadSchema.safeParse(block.input);
  if (!safe.success) {
    return { ok: false, reason: 'error', detail: whyMalformed(safe.error) };
  }

  // No concepts is a complete answer for a note that only records what happened.
  const chain = safe.data.concepts.length === 0 ? null : normaliseChain(safe.data, input.existing);
  if (!chain || safe.data.too_vague) {
    return {
      ok: false,
      reason: 'nothing-in-it',
      detail: 'Nothing in that note your graph does not already have.',
    };
  }

  return { ok: true, chain };
}

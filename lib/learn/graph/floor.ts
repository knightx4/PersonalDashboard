import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import {
  chainPayloadSchema,
  normaliseChain,
  type ExistingConcept,
  type ProposedChain,
} from '@/lib/learn/graph/chain-payload';
import { KIND_RULE, KIND_TOOL_FIELD } from '@/lib/learn/graph/kind-prompt';
import { MASTERY_RULE, MASTERY_TOOL_FIELD } from '@/lib/learn/graph/mastery-prompt';

/**
 * What a node rests on, when getting it wrong says the graph is missing a
 * level.
 *
 * Growth trigger 2, and the reading of a miss that this module is built on:
 * failing a question about something with nothing underneath it in the graph
 * is a fact about the graph before it is a fact about the person. There is
 * nothing to fall back to and nothing to be told to learn first, which means
 * the chain was drawn starting too high.
 *
 * One Sonnet call, the same model and the same rules as generating a chain for
 * a goal, because it is the same job pointed downwards: name the one or two
 * things this claim assumes, as claims, and attach them underneath. It reuses
 * normaliseChain, so a node with no edge and an edge that would close a cycle
 * are refused here exactly as they are anywhere else.
 *
 * Shown for approval like any other generated graph, and for a sharper reason
 * than usual: this is generated at the moment somebody has just got something
 * wrong, which is the moment they are least inclined to argue with a machine
 * telling them what they are missing.
 */

const MODEL = 'claude-sonnet-5';
const TOOL_NAME = 'report_chain';

const SYSTEM = `Somebody got a question wrong about one specific claim, and their
concept graph has nothing underneath that claim. Work out what it rests on.

ONE OR TWO PREREQUISITES. Never more than three. You are naming the level
immediately below, not rebuilding the subject from the ground up. The test: if
they understood this one thing, would the claim above stop being confusing?

CLAIMS, NOT HEADINGS. Each prerequisite is one thing somebody can be right or
wrong about, in a sentence or two. "Prices clear a market rather than measure
worth" is a node; "Supply and demand" is a chapter title.

EDGES. Every prerequisite you name must be joined to the claim above by an
edge, and to each other where one rests on the other. Nothing goes in the graph
without an edge.

DO NOT REPROPOSE what the subject already has. You are given its concepts by
name; when one of them is the missing floor, name it exactly as given and draw
the edge to it -- the graph was missing a connection rather than a node.

${MASTERY_RULE}

${KIND_RULE}

BASIS. Every node and edge says in one short sentence how you know it belongs.
It is shown to the reader.

IF NOTHING IS MISSING -- the claim is a floor, or it rests only on things the
subject already has edges to -- set too_vague true and propose nothing. Adding
a node for the sake of it makes the graph worse.`;

export type FloorResult =
  | { ok: true; chain: ProposedChain }
  | { ok: false; reason: 'nothing-missing' | 'error'; detail: string };

export async function proposeFloor(input: {
  subject: string;
  concept: string;
  claim: string;
  /** What the subject already holds, so it draws an edge instead of a twin. */
  existing: ExistingConcept[];
  /** The question they missed, which says something about where the gap is. */
  missedQuestion?: string | null;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<FloorResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  const lines = [
    `Subject: ${input.subject}`,
    '',
    `The claim they got wrong: ${input.concept} — ${input.claim}`,
  ];
  if (input.missedQuestion) {
    lines.push('', `The question they missed: ${input.missedQuestion}`);
  }
  if (input.existing.length > 0) {
    lines.push(
      '',
      'Concepts this subject already holds. Name any of these exactly as written when one of them is the missing floor:',
      ...input.existing.map((concept) => `- ${concept.name}`),
    );
  }
  lines.push(
    '',
    `Call ${TOOL_NAME}, with goal_concept set to "${input.concept}" and the prerequisites as concepts beneath it.`,
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
          description: 'Report what this claim rests on.',
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
                    mastery: MASTERY_TOOL_FIELD,
                    kind: KIND_TOOL_FIELD,
                  },
                  required: ['name', 'claim', 'basis', 'mastery', 'kind'],
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
            required: ['subject', 'goal_concept', 'concepts', 'edges'],
          },
        },
      ],
      messages: [{ role: 'user', content: lines.join('\n') }],
    });
  } catch (error) {
    return {
      ok: false,
      reason: 'error',
      detail: error instanceof Error ? error.message : 'Working out the floor failed.',
    };
  }

  input.onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') {
    return { ok: false, reason: 'error', detail: 'The call ran but reported nothing.' };
  }

  const safe = chainPayloadSchema.safeParse(block.input);
  if (!safe.success) {
    return { ok: false, reason: 'error', detail: 'That came back malformed.' };
  }

  // The concept itself is already in the subject, so it matches by name and
  // becomes the top of the chain rather than a second copy of itself.
  const chain = normaliseChain(safe.data, input.existing);
  if (!chain || safe.data.too_vague) {
    return {
      ok: false,
      reason: 'nothing-missing',
      detail:
        'Nothing missing underneath this one — it rests on things your graph already has. Worth another question rather than another node.',
    };
  }

  return { ok: true, chain };
}

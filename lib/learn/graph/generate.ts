import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import {
  chainPayloadSchema,
  normaliseChain,
  MAX_CHAIN,
  type ExistingConcept,
  type ProposedChain,
} from '@/lib/learn/graph/chain-payload';

/**
 * Turning a goal you typed into the chain of concepts leading to it.
 *
 * Sonnet rather than Opus, chosen rather than defaulted: this is judgment
 * about a well-mapped field, not a search of the open web. The reading side's
 * calls need the web because they are looking for a specific document; this
 * one is laying out what everybody who teaches the subject already agrees on,
 * and the model has that.
 *
 * What keeps it cheap is what does not go in. The subject's existing concepts
 * go in as a plain list of names -- not their claims, not their state, not the
 * edges between them -- because the only thing this call needs to know about
 * them is which ones it must not propose again. That is the difference between
 * a goal in a subject you already have costing a cent and costing ten.
 *
 * Nothing here writes. The chain comes back, gets shown, and is approved or
 * discarded by a person: a wrong graph is worse than no graph, and approval is
 * the cheapest check there is.
 */

const MODEL = 'claude-sonnet-5';
const TOOL_NAME = 'report_chain';

const SYSTEM = `You are laying out the prerequisite chain leading to something somebody
wants to understand, inside one subject.

A CONCEPT IS A CLAIM, NOT A HEADING. Every node is one thing a person can be
right or wrong about, stated in a sentence or two.

  Heading, useless: "The Phillips curve."
  Claim, usable: "Inflation and unemployment trade off in the short run because
  wage expectations adjust more slowly than prices, and the trade-off
  disappears once expectations catch up."

If you cannot state a node as a claim, it is a chapter title and does not
belong in the graph.

FEW NODES. The chain leading to this goal, not a survey of the subject. Three
to eight is normal; more than ${MAX_CHAIN} is never right. A specific goal
should produce a short targeted chain -- that is what keeps this honest.

NOTHING WITHOUT AN EDGE. Every node you propose must be joined to at least one
other by a prerequisite edge, and the chain must reach the goal node. A concept
you cannot say what sits under or on top of has not been placed, and an
unplaced node is a syllabus entry.

DO NOT REPROPOSE WHAT IS ALREADY THERE. You are given the concepts this subject
already holds. When one of them is a rung in this chain, name it exactly as
given and draw edges to it -- do not restate it in your own words, because a
near-duplicate under a slightly different name is the main way a graph like
this rots.

NO CYCLES. Prerequisites run one way. If A is needed for B then B is never
needed for A, however tempting the symmetry.

BASIS, HONESTLY. Every node and every edge carries a basis, one short sentence
on how you know it belongs. It is shown to the reader, so never imply you
checked something you did not: "standard in any intermediate macro sequence"
and "inferred from the goal, not checked against a syllabus" are different
claims and both are fine to make.

SUBJECT. Name the subject this goal belongs in. Prefer the one you were given
if the goal genuinely sits inside it. A subject has to be something one survey
course could plausibly cover: Economics yes, Philosophy yes, Machine learning
yes, Science no.

IF THE GOAL IS TOO VAGUE to lay out as a chain -- "economics", "everything
about physics" -- set too_vague true and propose nothing. A broad shallow sweep
is worse than an honest no.`;

export type GenerateResult =
  | { ok: true; chain: ProposedChain }
  | { ok: false; reason: 'too-vague' | 'nothing-new' | 'error'; detail: string };

/**
 * The claim a selected phrase was read out of.
 *
 * Growth trigger 5: the goal is a phrase somebody highlighted rather than a
 * sentence they typed, and on its own it is often a fragment. The claim around
 * it is what says which of its several meanings was meant, and naming the
 * concept it came from is what gets the new chain joined onto it instead of
 * left beside it.
 */
export type BranchFrom = { name: string; claim: string };

function buildPrompt(input: {
  goal: string;
  subject: string | null;
  existing: ExistingConcept[];
  from?: BranchFrom | null;
}): string {
  const lines = input.from
    ? [`They selected this phrase and asked to understand it: ${input.goal}`]
    : [`Goal, in their words: ${input.goal}`];

  if (input.subject) {
    lines.push('', `They are working inside the subject: ${input.subject}`);
  } else {
    lines.push('', 'They have no subject open. Name the one this belongs in.');
  }

  if (input.from) {
    lines.push(
      '',
      `They selected it while reading a claim they already hold, "${input.from.name}": ${input.from.claim}`,
      `Read the phrase in that light, and join the chain to "${input.from.name}" -- draw the edge whichever way round is right, under it or on top of it.`,
    );
  }

  if (input.existing.length > 0) {
    lines.push(
      '',
      'Concepts this subject already holds. Name any of these exactly as written when they are rungs in the chain, and do not restate them:',
      ...input.existing.map((concept) => `- ${concept.name}`),
    );
  } else {
    lines.push('', 'The subject is empty, so every node in the chain will be new.');
  }

  lines.push('', `Call ${TOOL_NAME}.`);
  return lines.join('\n');
}

/**
 * Propose a chain. Never throws.
 *
 * The three failures are separated because each sends the reader somewhere
 * different: a vague goal wants rewording, a goal whose chain you already have
 * wants nothing at all, and a broken call wants trying again.
 */
export async function generateChain(input: {
  goal: string;
  subject: string | null;
  existing: ExistingConcept[];
  /** Set when the goal is a phrase selected in a claim rather than typed. */
  from?: BranchFrom | null;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<GenerateResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the prerequisite chain leading to this goal.',
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
                  },
                  required: ['name', 'claim', 'basis'],
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
      messages: [{ role: 'user', content: buildPrompt(input) }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, reason: 'error', detail: 'Rate limited. Try again shortly.' };
    }
    return {
      ok: false,
      reason: 'error',
      detail: error instanceof Error ? error.message : 'Laying out the chain failed.',
    };
  }

  // Before the response is judged. A chain that came back unusable still cost
  // what it cost.
  input.onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') {
    return { ok: false, reason: 'error', detail: 'The call ran but reported nothing.' };
  }

  const safe = chainPayloadSchema.safeParse(block.input);
  if (!safe.success) {
    return { ok: false, reason: 'error', detail: 'The chain came back malformed.' };
  }

  if (safe.data.too_vague) {
    return {
      ok: false,
      reason: 'too-vague',
      detail:
        'Too broad to lay out as a chain. Name the specific thing you want to understand — the narrower it is, the better this works.',
    };
  }

  const chain = normaliseChain(safe.data, input.existing);
  if (!chain) {
    return {
      ok: false,
      reason: 'nothing-new',
      detail: 'Nothing here that your graph does not already have. Try a more specific goal.',
    };
  }

  return { ok: true, chain };
}

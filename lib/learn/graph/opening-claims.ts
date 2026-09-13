import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import {
  MIN_CLAIMS,
  normaliseClaims,
  openingPayloadSchema,
  TARGET_CLAIMS,
  type OpeningClaim,
} from '@/lib/learn/graph/opening-payload';

/**
 * Ten claims spread across a subject, from the thing somebody typed.
 *
 * Deliberately not a chain. generate.ts lays out the route to one point and
 * draws the edges; this names ten things from across the whole field, in no
 * order, joined to nothing. What they are for is the ten questions asked
 * before anything is generated, so breadth is the property that matters and
 * depth is the one that would ruin it: ten claims about the same corner
 * measure one corner.
 *
 * One Sonnet call, on the same reasoning as the chain: this is judgment about
 * a well-mapped field rather than a search of the open web. Nothing is saved.
 * The claims come back, questions get written against them, and the sweep is
 * what gets stored.
 */

const MODEL = 'claude-sonnet-5';
const TOOL_NAME = 'report_claims';

const SYSTEM = `Somebody has named something they want to learn and has never studied it
here. Before anything is laid out for them, name the subject it belongs to and
${TARGET_CLAIMS} claims spread across the whole of that subject.

A CLAIM, NOT A HEADING. Every one is a single thing a person can be right or
wrong about, stated in a sentence or two.

  Heading, useless: "Comparative advantage."
  Claim, usable: "A country gains from trading even when it makes everything
  less efficiently than its partner, because what it gives up to make one good
  is what decides where it should specialise."

ACROSS THE SUBJECT, NOT TOWARDS THE GOAL. These are not the route to what they
asked for. They are a spread over the field, from the ideas anybody meets in
the first week to ones that turn up late, so that what comes back says where
this person is starting from rather than how far along one path they are.

NO TWO OF THEM THE SAME. Two names for one idea wastes a question and counts
one part of the subject twice.

ANSWERABLE FROM MEMORY, IN A PHRASE OR A SENTENCE. Each claim will be turned
into one question somebody writes an answer to without looking anything up. A
claim that could only be answered with a derivation or a number is not one of
these.

SHORT NAME, REAL CLAIM. The name is a few words for the idea; the claim is the
sentence that can be wrong.

SUBJECT. Name the subject the thing they typed sits in. It has to be something
one survey course could plausibly cover: Economics yes, Philosophy yes, Machine
learning yes, Science no.

IF WHAT THEY TYPED NAMES NO SINGLE SUBJECT with prerequisite structure in it --
"science", "everything about the world", a typo, somebody's name -- set
no_structure true and name no claims. Ten plausible sentences about nothing is
worse than an honest no.`;

export type OpeningClaimsResult =
  | { ok: true; subject: string; claims: OpeningClaim[] }
  | { ok: false; reason: 'no-structure' | 'too-few' | 'error'; detail: string };

/**
 * Name the subject and the claims to ask about. Never throws.
 *
 * The three failures are separated because each sends the reader somewhere
 * different: something with no subject in it wants rewording, a list that came
 * back too thin wants trying again, and a broken call wants trying again for a
 * different reason.
 */
export async function nameOpeningClaims(input: {
  asked: string;
  anthropicApiKey: string;
  client?: Anthropic;
  /** Told what the call cost, before anything is made of what it returned. */
  onSpend?: SpendSink;
}): Promise<OpeningClaimsResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the subject and the claims spread across it.',
          input_schema: {
            type: 'object',
            properties: {
              subject: { type: 'string' },
              no_structure: { type: 'boolean' },
              claims: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    claim: { type: 'string' },
                  },
                  required: ['name', 'claim'],
                },
              },
            },
            required: ['subject', 'claims'],
          },
        },
      ],
      messages: [
        {
          role: 'user',
          content: [
            `What they typed: ${input.asked}`,
            '',
            `Name the subject and ${TARGET_CLAIMS} claims across it, then call ${TOOL_NAME}.`,
          ].join('\n'),
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, reason: 'error', detail: 'Rate limited. Try again shortly.' };
    }
    return {
      ok: false,
      reason: 'error',
      detail: error instanceof Error ? error.message : 'Naming the claims failed.',
    };
  }

  // Before the answer is judged: a malformed one still cost what it cost.
  input.onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') {
    return { ok: false, reason: 'error', detail: 'The call ran but reported nothing.' };
  }

  const safe = openingPayloadSchema.safeParse(block.input);
  if (!safe.success) {
    return { ok: false, reason: 'error', detail: 'The claims came back malformed.' };
  }

  // A model that says both "no structure here" and here are ten claims has
  // contradicted itself, and the half to trust is the admission.
  if (safe.data.no_structure) {
    return {
      ok: false,
      reason: 'no-structure',
      detail:
        'That is broader than one subject, so there is no shared ground to ask about. Name the field you want to start in.',
    };
  }

  const claims = normaliseClaims(safe.data);
  if (claims.length < MIN_CLAIMS) {
    return {
      ok: false,
      reason: 'too-few',
      detail: 'Not enough usable claims came back to span the subject. Try again.',
    };
  }

  return { ok: true, subject: safe.data.subject, claims };
}

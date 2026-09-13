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
import { MASTERY_RULE, MASTERY_TOOL_FIELD } from '@/lib/learn/graph/mastery-prompt';

/**
 * What you already know, told directly.
 *
 * Slice 6. Every other way into the graph waits for you to do something --
 * name a goal, finish a reading, answer a probe -- and none of them can reach
 * the decade of work you did before this application existed. This one takes
 * the account you can write in five minutes, or the essay and the syllabus you
 * already have, and turns it into nodes.
 *
 * Sonnet rather than Haiku, unlike the note reader, and for one reason: half
 * of what gets pasted here is headings. "Macro I: IS-LM, the Phillips curve,
 * Okun's law" is a list of things you were in a room for, and turning it into
 * claims you can be right or wrong about means writing down what the room
 * probably covered -- which is inventing a graph and putting your name on it.
 * The judgment worth paying for is the refusal, and Haiku will not refuse.
 *
 * Nothing here writes, and what it proposes is not marked known until somebody
 * approves it. Both matter more here than anywhere else in the module: a
 * concept that lands as `known` is a concept that never appears in front of
 * you again, so a wrong one is invisible from the moment it is wrong.
 */

const MODEL = 'claude-sonnet-5';
const TOOL_NAME = 'report_chain';

const SYSTEM = `Somebody is telling you what they already know, so it can be added to a
graph of their knowledge. The text is theirs: an account they wrote, an essay,
a syllabus, a transcript, a write-up of work they cannot show you.

CLAIMS, NOT HEADINGS. Every node is one thing a person can be right or wrong
about, stated in a sentence or two.

  Heading, useless: "Econometrics II."
  Claim, usable: "An instrument has to be correlated with the regressor and
  uncorrelated with the error, and the second half cannot be tested."

ONLY WHAT THE TEXT ACTUALLY SHOWS. This is the rule that matters here and the
one you will be tempted to break. A course title, a module code, a grade, a job
title, a book in a reading list -- these say somebody was present, not what
they understood. If the text does not state the idea, you do not know it, and
writing down what that course probably covered is inventing somebody's
knowledge and attributing it to them.

  "BSc Economics, 2016-2019. Micro I, Macro I, Econometrics." -> nothing.
  Set too_vague true. There is not one claim in it.

  "We spent Macro I on IS-LM and I never believed the LM curve -- the central
  bank sets the rate, it does not sit on a money supply and let the rate
  clear." -> one claim, and a good one.

So: a syllabus with topic lines and no content gives you nothing. An essay
gives you what it argues. An account of work gives you what it says was
understood. When the whole text is headings, return nothing and say so rather
than filling the gap.

FEW. One to eight, never more than ${MAX_CHAIN}. The strongest few claims the
text really evidences, not everything it brushes past.

EDGES. Join them to each other where one rests on the other, and to the
concepts the subject already holds -- you are given those by name. Nothing goes
in the graph without an edge.

DO NOT REPROPOSE what the subject already has. Name it exactly as given and
draw the edge instead.

${MASTERY_RULE}

BASIS, HONESTLY. Each node and edge carries one short sentence on how you know
it belongs, and it is shown to the reader. Here that sentence says where in
their own account it came from -- "they state this outright about their
dissertation work" is a different claim from "implied by the essay's argument",
and the reader is entitled to tell them apart.

SUBJECT. Name the subject this belongs in -- something one survey course could
cover. Economics yes, Machine learning yes, Science no. Prefer the one you were
given if the text genuinely sits inside it.

IF THE TEXT STATES NO CLAIMS -- it is a CV, a list of courses, a grade
transcript, a reading list -- set too_vague true and propose nothing.`;

export type FromPriorResult =
  | { ok: true; chain: ProposedChain }
  | { ok: false; reason: 'nothing-in-it' | 'error'; detail: string };

export async function conceptsFromPrior(input: {
  /** The subject to place this in, when there is one. Null lets it name one. */
  subject: string | null;
  /** What they wrote or pasted. */
  account: string;
  existing: ExistingConcept[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<FromPriorResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  const lines = input.subject ? [`Subject: ${input.subject}`, ''] : [];
  lines.push('What they say they already know:', input.account);

  if (input.existing.length > 0) {
    lines.push(
      '',
      'Concepts this subject already holds — name these exactly as written rather than restating them:',
      ...input.existing.map((concept) => `- ${concept.name}`),
    );
  }
  lines.push(
    '',
    `Call ${TOOL_NAME}, with goal_concept set to whichever concept this account is most about.`,
  );

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the concepts this account shows they already know.',
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
                  },
                  required: ['name', 'claim', 'basis', 'mastery'],
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
      detail: error instanceof Error ? error.message : 'Reading that account failed.',
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

  const chain = normaliseChain(safe.data, input.existing);
  if (!chain || safe.data.too_vague) {
    return {
      ok: false,
      reason: 'nothing-in-it',
      detail:
        'Nothing in that states a claim your graph does not already have. Course titles and reading lists say you were there, not what you understood — say what you actually think about one of them.',
    };
  }

  return { ok: true, chain };
}

import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { whyMalformed } from '@/lib/learn/graph/chain-payload';
import { THINKING_ROOM, forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import type { MapTopic } from '@/lib/learn/levels/draft-payload';
import { LADDER } from '@/lib/learn/levels/ladder';
import { assignPayloadSchema, readAssignment, type Assignment, type MoveConcept } from '@/lib/learn/levels/move';

/**
 * Step 1 of the move from the claims graph (docs/LEARN-LEVELS-SPEC.md,
 * "Migration from the claims graph"): one call per subject puts each of its
 * concepts on a topic and a level, naming any topic the map does not have.
 *
 * Sonnet, as for drafting: choosing the topic a claim belongs to and how deep
 * in it the claim sits is the same judgment as laying the levels out. The
 * call is told the map as it stands, which grows subject by subject, so the
 * later subjects reuse the topics the earlier ones drafted.
 *
 * Nothing here writes.
 */

const MODEL = MODELS.learnTopicAssign;
const TOOL_NAME = 'report_placements';

const LADDER_LINES = LADDER.map((l) => `${l.level} (${l.band}): you can ${l.can}`).join('\n');

const SYSTEM = `You are moving somebody's ideas from an old list of claims onto a map of topics.

A topic is something a person would name when saying what they know: Return,
Beta, CAPM, DCF, Braess's paradox. Every topic has the same ladder of ten
levels, each defined by what you can do:

${LADDER_LINES}

For every claim you are given, choose the topic it belongs to and the level
of that topic the claim is about. "Value is the discounted sum of future cash
flows" is DCF level 2. "Terminal value dominates a DCF of a high-growth
company" is DCF level 7.

USE THE MAP. Put a claim on a topic already on the map whenever one fits,
named exactly as given. Never put a claim above the level a map topic stops
at.

NEW TOPICS. When no topic on the map fits, name a new one the way a textbook
index would, and list it under new_topics with a one-sentence scope saying
what it covers and what it leaves to its neighbours. Prefer one topic that
several claims share over a topic per claim, but do not stretch a topic to
cover a claim that is about something else.

UNSURE. When you are not confident of the topic or the level, say why in
unsure, in one short sentence the person will read. Leave it out when you are
sure.

Place every claim. Call ${TOOL_NAME}.`;

export type AssignInput = {
  subject: string;
  concepts: readonly MoveConcept[];
  map: readonly MapTopic[];
};

export type AssignResult = { ok: true; assignment: Assignment } | { ok: false; detail: string };

/** The prompt, exported so a test can read what the call is told. */
export function assignPrompt(input: AssignInput): string {
  const lines = [`Subject: ${input.subject}`, '', 'Claims (number. name: claim):'];
  input.concepts.forEach((c, i) => lines.push(`${i + 1}. ${c.name}: ${c.claim}`));
  if (input.map.length > 0) {
    lines.push(
      '',
      'Topics on their map (name, highest level, scope):',
      ...input.map.map((t) => `- ${t.name} (to ${t.ceiling}): ${t.scope}`),
    );
  } else {
    lines.push('', 'Their map has no topics yet, so every topic goes under new_topics.');
  }
  lines.push('', `Call ${TOOL_NAME}.`);
  return lines.join('\n');
}

/** Place one subject's concepts. Never throws. */
export async function assignConcepts(
  input: AssignInput & { anthropicApiKey: string; client?: Anthropic; onSpend?: SpendSink },
): Promise<AssignResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096 + THINKING_ROOM,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the topic and level for every claim.',
          input_schema: {
            type: 'object',
            properties: {
              placements: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    concept: { type: 'integer', minimum: 1 },
                    topic: { type: 'string' },
                    level: { type: 'integer', minimum: 1, maximum: 10 },
                    unsure: { type: 'string' },
                  },
                  required: ['concept', 'topic', 'level'],
                },
              },
              new_topics: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { name: { type: 'string' }, scope: { type: 'string' } },
                  required: ['name', 'scope'],
                },
              },
            },
            required: ['placements'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME, MODEL),
      messages: [{ role: 'user', content: assignPrompt(input) }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return { ok: false, detail: 'Rate limited. Try again shortly.' };
    return { ok: false, detail: error instanceof Error ? error.message : 'Placing the ideas failed.' };
  }

  input.onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };

  const safe = assignPayloadSchema.safeParse(block.input);
  if (!safe.success) return { ok: false, detail: whyMalformed(safe.error) };

  return { ok: true, assignment: readAssignment(safe.data, input.concepts, input.map) };
}

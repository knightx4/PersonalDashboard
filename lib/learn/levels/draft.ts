import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { whyMalformed } from '@/lib/learn/graph/chain-payload';
import { THINKING_ROOM, forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import {
  MAX_CHECKS,
  MIN_CHECKS,
  draftPayloadSchema,
  normaliseDraft,
  type FieldOption,
  type MapTopic,
  type TopicDraft,
} from '@/lib/learn/levels/draft-payload';
import { LADDER } from '@/lib/learn/levels/ladder';

/**
 * Drafting one topic with its ladder of levels (docs/LEARN-LEVELS-SPEC.md,
 * "Drafting a topic"): one model call, from a goal the person named.
 *
 * Sonnet, for the reason lib/learn/graph/generate.ts gives: laying out what
 * teachers of a well-mapped field agree on needs judgment and no web search.
 *
 * What goes in about the map is each topic's name, scope and ceiling, which
 * is what the call needs to link to the right one at the right level and not
 * to draft it again. Nothing about what the person knows goes in: the draft
 * describes the topic, and where they stand on it is computed later.
 *
 * Nothing here writes. The draft comes back, is kept as a draft that nothing
 * asks about, and the person reads and rewords it before approving.
 */

const MODEL = MODELS.learnTopicDraft;
const TOOL_NAME = 'report_topic';

const LADDER_LINES = LADDER.map((l) => `${l.level} (${l.band}): you can ${l.can}`).join('\n');

const SYSTEM = `You are drafting one topic for somebody's map of what they know.

A topic is something a person would name when saying what they know: Return,
Beta, CAPM, DCF, Braess's paradox. Every topic shares the same ladder of ten
levels, each defined by what you can do:

${LADDER_LINES}

NAME AND SCOPE. Name the topic the way a textbook index would. The scope is
one sentence saying what it covers and what it leaves to its neighbours; it is
what duplicates are found by, so make it specific.

CEILING. The highest level with real content for this topic. "What a return
is" has nothing at level 10; CAPM does. Most narrow topics stop between 5 and
8. Write no levels above the ceiling.

CHECKS. For every level from 1 to the ceiling, write ${MIN_CHECKS} to ${MAX_CHECKS}
checks saying what meeting that level looks like for this topic. Each check is
something an answer could meet or fail to, and failing it would cost the person
something. "Can explain why free cash flow is used rather than net income" is a
check. "Understands DCF well" is not, and is rejected. Start each with a verb
of doing: can explain, can compute, can say why, can name. Keep each to one
line.

LINKS. A level can require a level of another topic: CAPM 3 requires Return 2.
Name the LOWEST level the requiring level needs. CAPM 3 needs to know what a
return is, not the difference between arithmetic and geometric means. Too high
is the mistake that matters. A link from a level holds for every level above
it, so link from the lowest level that needs it and never repeat it higher up.
Link only to the topics you are given, named exactly as given, at a level they
have. Never link to this topic itself.

MISSING. When a level needs a topic the map does not have, list it under
missing with its name, a one-sentence scope, and the levels the link would
join. Do not draft it; it is drafted separately if the person wants it.

FIELDS. Tag the topic with the fields it belongs to, by slug, from the list
you are given. One or two is normal; none is fine when nothing fits.

IF THE GOAL IS TOO BROAD to be one topic -- "finance", "physics" -- set
too_vague true and leave the rest empty. When the goal is a question rather
than a topic name, draft the topic the question is about.

Call ${TOOL_NAME}.`;

export type DraftInput = {
  /** The goal, in the person's words. */
  goal: string;
  /**
   * When the topic is one a draft's link needed: the scope that draft gave
   * it, so the new draft covers what the link meant.
   */
  scope?: string | null;
  map: readonly MapTopic[];
  fields: readonly FieldOption[];
};

export type DraftResult =
  | { ok: true; draft: TopicDraft }
  | { ok: false; reason: 'too-vague' | 'error'; detail: string };

/** The prompt, exported so a test can read what the call is told. */
export function draftPrompt(input: DraftInput): string {
  const lines = [`Goal, in their words: ${input.goal}`];
  if (input.scope) lines.push('', `Another topic needs this one, with this scope: ${input.scope}`);

  const approved = input.map.filter((t) => t.approved);
  if (approved.length > 0) {
    lines.push(
      '',
      'Topics already on their map (name, ceiling, scope). Link to these by exact name; do not draft one of them again:',
      ...approved.map((t) => `- ${t.name} (to ${t.ceiling}): ${t.scope}`),
    );
  } else {
    lines.push('', 'Their map has no topics yet, so any topic a level needs goes under missing.');
  }

  if (input.fields.length > 0) {
    lines.push('', 'Fields (slug: name):', ...input.fields.map((f) => `- ${f.slug}: ${f.name}`));
  }

  lines.push('', `Call ${TOOL_NAME}.`);
  return lines.join('\n');
}

const LEVEL = { type: 'integer', minimum: 1, maximum: 10 } as const;

/** Draft a topic. Never throws. */
export async function draftTopic(
  input: DraftInput & { anthropicApiKey: string; client?: Anthropic; onSpend?: SpendSink },
): Promise<DraftResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 8192 + THINKING_ROOM,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the drafted topic with its levels and links.',
          input_schema: {
            type: 'object',
            properties: {
              too_vague: { type: 'boolean' },
              name: { type: 'string' },
              scope: { type: 'string' },
              ceiling: LEVEL,
              fields: { type: 'array', items: { type: 'string' } },
              levels: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    level: LEVEL,
                    checks: { type: 'array', items: { type: 'string' } },
                  },
                  required: ['level', 'checks'],
                },
              },
              links: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    from_level: LEVEL,
                    topic: { type: 'string' },
                    level: LEVEL,
                    why: { type: 'string' },
                  },
                  required: ['from_level', 'topic', 'level'],
                },
              },
              missing: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    scope: { type: 'string' },
                    from_level: LEVEL,
                    level: LEVEL,
                    why: { type: 'string' },
                  },
                  required: ['name', 'scope', 'from_level', 'level'],
                },
              },
            },
            required: ['name', 'scope', 'ceiling', 'levels'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME, MODEL),
      messages: [{ role: 'user', content: draftPrompt(input) }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, reason: 'error', detail: 'Rate limited. Try again shortly.' };
    }
    return {
      ok: false,
      reason: 'error',
      detail: error instanceof Error ? error.message : 'Drafting the topic failed.',
    };
  }

  // Before the reply is judged: an unusable draft still cost what it cost.
  input.onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') {
    return { ok: false, reason: 'error', detail: whyNoReport(response) };
  }

  const safe = draftPayloadSchema.safeParse(block.input);
  if (!safe.success) return { ok: false, reason: 'error', detail: whyMalformed(safe.error) };

  const result = normaliseDraft(safe.data, input.map, input.fields);
  if (!result.ok) {
    return { ok: false, reason: result.reason === 'too-vague' ? 'too-vague' : 'error', detail: result.detail };
  }
  return { ok: true, draft: result.draft };
}

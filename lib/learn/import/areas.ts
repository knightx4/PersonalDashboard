import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';

/**
 * What is inside "economics".
 *
 * plan-topic.ts refuses a topic it cannot route through, and until now that
 * refusal was the end of the road: a sentence asking you to be more specific
 * about a subject you do not yet know the parts of. This call is what happens
 * next. It takes the same string and names the areas within it -- how prices
 * get set, what a central bank does, trade between countries -- so the answer
 * to "be more specific" is a list to pick from rather than a second guess.
 *
 * It searches for nothing and sources nothing, which is what keeps it cheap
 * beside the planner: one Sonnet call against what the model already knows,
 * naming parts of a subject rather than finding anything to read about them.
 * Each area is planned separately, later, when you open it.
 */

const MODEL = 'claude-sonnet-5';
const TOOL_NAME = 'report_areas';

/** Fewer than this and the topic was not broad enough to need branching. */
export const MIN_AREAS = 4;
/** More than this and picking from the list is the new problem. */
export const MAX_AREAS = 8;

const SYSTEM = `You are given a subject somebody wants to learn, in their own words, and it
is too broad to plan a route through. Name the areas inside it.

FOUR TO EIGHT AREAS. Each is a part of the subject somebody could study on its
own and come out understanding something: for economics, "how prices get set",
"what a central bank does", "trade between countries". Between them they should
cover most of what the subject is, without overlapping each other.

NAME THEM AS A PERSON WOULD ASK ABOUT THEM, not as a syllabus names them. "What
a central bank does" over "Monetary policy and the money supply". Somebody who
does not know the field yet has to be able to tell these apart, which is the
whole job: they are about to pick between them.

ONE LINE EACH on what the area covers, said plainly. It is read next to a tick
box by somebody deciding whether they care about this part, so it says what is
in there, not why it matters.

DO NOT NAME ANYTHING TO READ. No books, no authors, no courses. Each area gets
planned on its own later, and naming a source now is a guess made without
looking.

IF THE STRING NAMES NO SUBJECT AT ALL -- a typo, a sentence, somebody's name,
a thing that is not a field of study -- set not_a_subject true and return no
areas. Areas invented for a subject nobody named are four plausible lines about
nothing.`;

/** One part of a broad subject, as it is offered to be kept. */
export type Area = {
  name: string;
  /** One line on what studying it covers. */
  covers: string;
};

export type AreasResult =
  | { ok: true; areas: Area[] }
  | { ok: false; reason: 'not-a-subject' | 'no-areas' | 'error'; detail: string };

export const areaSchema = z.object({
  name: z.string().trim().min(1).max(120),
  covers: z.string().trim().max(300).nullable().optional(),
});

export const areasPayloadSchema = z.object({
  areas: z.array(areaSchema).max(30).default([]),
  /** Said out loud when the string is not a subject to begin with. */
  not_a_subject: z.boolean().default(false),
});

export type AreasPayload = z.infer<typeof areasPayloadSchema>;

/**
 * The rules applied after the model has spoken.
 *
 * Order is the model's and is left alone. An area with no line under it is
 * dropped rather than shown bare: the list is what somebody picks from, and a
 * name on its own makes them guess what is inside it, which is the position
 * they were already in.
 */
export function normaliseAreas(payload: AreasPayload): Area[] {
  const seen = new Set<string>();
  const areas: Area[] = [];

  for (const raw of payload.areas) {
    const name = raw.name.trim();
    const covers = raw.covers?.trim() ?? '';
    if (!name || !covers) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    areas.push({ name, covers });
    if (areas.length >= MAX_AREAS) break;
  }

  return areas;
}

/**
 * Name the areas inside a topic. Never throws.
 *
 * Called only after the planner has already reported the topic as too broad,
 * so it is not asked to judge breadth a second time -- that question is
 * settled by the time it runs, and asking it again is how one screen ends up
 * disagreeing with itself.
 */
export async function nameAreas(input: {
  topic: string;
  anthropicApiKey: string;
  client?: Anthropic;
  /** Told what the call cost, before anything is made of what it returned. */
  onSpend?: SpendSink;
}): Promise<AreasResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the areas inside this subject.',
          input_schema: {
            type: 'object',
            properties: {
              not_a_subject: { type: 'boolean' },
              areas: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    covers: { type: 'string' },
                  },
                  required: ['name', 'covers'],
                },
              },
            },
            required: ['areas'],
          },
        },
      ],
      messages: [
        {
          role: 'user',
          content: [
            `Subject: ${input.topic}`,
            '',
            `Name between ${MIN_AREAS} and ${MAX_AREAS} areas inside it, then call ${TOOL_NAME}.`,
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
      detail: error instanceof Error ? error.message : 'Looking inside the topic failed.',
    };
  }

  // Before the answer is judged: a malformed one still cost what it cost.
  input.onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') {
    return { ok: false, reason: 'error', detail: 'The call ran but reported nothing.' };
  }

  const safe = areasPayloadSchema.safeParse(block.input);
  if (!safe.success) {
    return { ok: false, reason: 'error', detail: 'The areas came back malformed.' };
  }

  // A model that says both "not a subject" and here are five areas has
  // contradicted itself, and the half to trust is the admission.
  if (safe.data.not_a_subject) {
    return {
      ok: false,
      reason: 'not-a-subject',
      detail: 'That does not name a topic, so there is nothing inside it to look at.',
    };
  }

  const areas = normaliseAreas(safe.data);
  if (areas.length === 0) {
    return {
      ok: false,
      reason: 'no-areas',
      detail: 'No areas came back for this one.',
    };
  }

  return { ok: true, areas };
}

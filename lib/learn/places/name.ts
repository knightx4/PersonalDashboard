import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';

/**
 * Naming the places on Idea Space (plan #1997.2).
 *
 * One Haiku call names every place that needs a name in a run: the new ones,
 * and those whose ideas changed by more than a third since they were named
 * (lib/learn/places/reconcile.ts). Most days that is none or a few, so most
 * days there is no call. Each place is described by up to twelve of its
 * ideas, and the names already in use are given so a new name does not
 * repeat one.
 */

export const PLACE_NAME_MODEL = MODELS.learnPlaceNames;

/** The most places named in one call; more are named by further calls. */
export const PLACES_PER_CALL = 40;

/** The most ideas shown to the model for one place. */
export const IDEAS_SHOWN = 12;

/** The longest name kept. */
export const NAME_MAX = 48;

const TOOL_NAME = 'report_place_names';

export type PlaceToName = {
  /** Any key the caller can match the name back with. */
  key: string;
  ideas: { name: string; claim: string }[];
};

export type NameResult = { ok: true; names: Map<string, string> } | { ok: false; detail: string };

const SYSTEM = `You name places on a map of one person's ideas.

Each place is a group of ideas that sit close together because they are about
the same thing. Give each place a short name that says what its ideas have in
common, so the person can find their way around the map by it.

What makes a good name:
- Two to six words, under ${NAME_MAX} characters, in sentence case: "Chip
  shortages and the bullwhip", "Pricing power in SaaS", "Sleep and memory".
- Specific to these ideas. "Economics" or "Business ideas" would fit half the
  map; name the particular ground these ideas share.
- Plain words the person would use, with no jargon the ideas do not use
  themselves, no quotation marks and no full stop.
- Different from every other name on the map, including the ones you are told
  are already in use.

Report through ${TOOL_NAME}, one name for every place, by its number.`;

const payloadSchema = z.object({
  names: z.array(z.object({ place: z.number().int(), name: z.string() })),
});

/** The user message for one call. Exported for the test. */
export function describePlaces(places: readonly PlaceToName[], inUse: readonly string[]): string {
  const lines: string[] = [];
  places.forEach((place, i) => {
    lines.push(`Place ${i + 1}:`);
    for (const idea of place.ideas.slice(0, IDEAS_SHOWN)) {
      const claim = idea.claim.trim().slice(0, 200);
      lines.push(claim && claim !== idea.name ? `- ${idea.name}: ${claim}` : `- ${idea.name}`);
    }
    lines.push('');
  });
  if (inUse.length > 0) {
    lines.push('Names already in use on the map, not to repeat:');
    lines.push(...inUse.map((name) => `- ${name}`));
    lines.push('');
  }
  lines.push(`Call ${TOOL_NAME} with a name for each of the ${places.length} places.`);
  return lines.join('\n');
}

/** A name as kept: trimmed, unquoted, no closing full stop, at most NAME_MAX characters. */
export function cleanName(raw: string): string {
  let name = raw.trim().replace(/\s+/g, ' ').replace(/^["'“‘]+|["'”’]+$/g, '').replace(/\.$/, '').trim();
  if (name.length > NAME_MAX) {
    const cut = name.slice(0, NAME_MAX + 1);
    const space = cut.lastIndexOf(' ');
    name = (space > 0 ? cut.slice(0, space) : name.slice(0, NAME_MAX)).trim();
  }
  return name;
}

/**
 * Read the tool payload into names by key. Pure, and exported for the test.
 * A number out of range, an empty name, a second name for the same place and
 * a name already used (on the map or earlier in the reply) are left out; a
 * place left without a name is tried again the next day.
 */
export function readNames(input: unknown, places: readonly PlaceToName[], inUse: readonly string[]): NameResult {
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, detail: 'The report did not match its schema.' };
  const taken = new Set(inUse.map((name) => name.toLowerCase()));
  const names = new Map<string, string>();
  for (const entry of parsed.data.names) {
    const place = places[entry.place - 1];
    const name = cleanName(entry.name);
    if (!place || !name || names.has(place.key) || taken.has(name.toLowerCase())) continue;
    taken.add(name.toLowerCase());
    names.set(place.key, name);
  }
  return { ok: true, names };
}

/** Name up to PLACES_PER_CALL places in one call. */
export async function namePlaces(input: {
  places: readonly PlaceToName[];
  /** Names of the places keeping theirs, so none is repeated. */
  inUse: readonly string[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<NameResult> {
  const places = input.places.slice(0, PLACES_PER_CALL);
  if (places.length === 0) return { ok: true, names: new Map() };
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  let response;
  try {
    response = await client.messages.create({
      model: PLACE_NAME_MODEL,
      max_tokens: 2048,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report a short name for each place, by its number.',
          input_schema: {
            type: 'object',
            properties: {
              names: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { place: { type: 'integer' }, name: { type: 'string' } },
                  required: ['place', 'name'],
                },
              },
            },
            required: ['names'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME, PLACE_NAME_MODEL),
      messages: [{ role: 'user', content: describePlaces(places, input.inUse) }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return { ok: false, detail: 'Rate limited.' };
    return { ok: false, detail: error instanceof Error ? error.message : 'The naming call failed.' };
  }

  // Before the reply is read: a malformed report still cost what it cost.
  input.onSpend?.({ model: PLACE_NAME_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };
  return readNames(block.input, places, input.inUse);
}

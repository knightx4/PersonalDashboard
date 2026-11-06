import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { answerQuestion } from '@/lib/dash/ask';
import { ASK_DASH_TOOLS } from '@/lib/dash/registry';
import type { PlacesLookupInput, PlacesLookupResult } from '@/lib/you/places-lookup';
import type { AskContext, AskDb } from './db';
import { distanceText, FIND_PLACES_TOOL } from './places';
import { executeAskTool, IN_APP_ONLY_TOOLS, lookupInScope } from './tools';

/** find_places (plan #2987.3): Ask Dash looking up places near home. */

const THAI: PlacesLookupResult = {
  status: 'ok',
  places: [
    {
      name: 'Kin Khao',
      address: '55 Cyril Magnin St, San Francisco',
      lat: 37.785,
      lng: -122.409,
      rating: 4.5,
      ratingCount: 2210,
      priceLevel: 2,
      openNow: true,
      todayHours: '5:00 – 9:30 PM',
      mapsUrl: 'https://maps.google.com/?cid=111',
      distanceMeters: 850,
      distanceFromNearMeters: null,
    },
    {
      name: 'Lers Ros',
      address: '730 Larkin St, San Francisco',
      lat: 37.784,
      lng: -122.417,
      rating: 4.3,
      ratingCount: 1800,
      priceLevel: null,
      openNow: null,
      todayHours: null,
      mapsUrl: 'https://maps.google.com/?cid=222',
      distanceMeters: 2400,
      distanceFromNearMeters: null,
    },
  ],
  center: { lat: 37.78, lng: -122.41, label: 'home', isHome: true },
  radiusMeters: 4000,
  widened: true,
  cached: false,
  fetchedAt: '2026-11-06T19:00:00.000Z',
};

const CAP: PlacesLookupResult = {
  status: 'refused',
  reason: 'cap_reached',
  message: "Dash has made today's 50 place lookups, the daily limit. Ask again tomorrow.",
};

function context(result: PlacesLookupResult | null) {
  const asked: PlacesLookupInput[] = [];
  const ctx: AskContext = {
    userId: '00000000-0000-4000-8000-00000000000a',
    today: '2026-11-06',
    enabledModules: ['you'],
    db: (async () => {
      throw new Error('find_places reads no table itself');
    }) as AskDb,
    searchSources: [],
    ...(result
      ? {
          findPlaces: async (input: PlacesLookupInput) => {
            asked.push(input);
            return result;
          },
        }
      : {}),
  };
  return { ctx, asked };
}

describe('find_places', () => {
  it('hands the places back with distance, rating, hours and the Maps link for each', async () => {
    const { ctx, asked } = context(THAI);
    const result = await executeAskTool(FIND_PLACES_TOOL, { query: 'thai restaurant', open_now: true }, ctx);
    if (!result.ok) throw new Error(result.error);
    expect(asked).toEqual([{ query: 'thai restaurant', near: null, radiusMeters: null, openNow: true }]);
    expect(result.rows).toEqual([]);
    expect(result.found).toEqual([
      {
        name: 'Kin Khao',
        address: '55 Cyril Magnin St, San Francisco',
        distance_from_home: '850 m',
        rating: 4.5,
        ratings: 2210,
        price: '$$',
        open_now: true,
        today_hours: '5:00 – 9:30 PM',
        maps_url: 'https://maps.google.com/?cid=111',
      },
      expect.objectContaining({ name: 'Lers Ros', distance_from_home: '2.4 km', price: null, maps_url: 'https://maps.google.com/?cid=222' }),
    ]);
    expect(result.note).toContain('within 4.0 km of home, after widening');
    expect(result.note).toContain('maps_url with each place you name');
  });

  it('passes a refusal or a failure on in its own words', async () => {
    expect(await executeAskTool(FIND_PLACES_TOOL, { query: 'thai' }, context(CAP).ctx)).toEqual({ ok: false, error: CAP.message });
    const key: PlacesLookupResult = { status: 'refused', reason: 'not_set_up', message: "Dash can't look places up yet." };
    expect(await executeAskTool(FIND_PLACES_TOOL, { query: 'thai' }, context(key).ctx)).toEqual({ ok: false, error: key.message });
    const down: PlacesLookupResult = { status: 'failed', message: "Dash couldn't reach Google Places just now.", detail: '503' };
    expect(await executeAskTool(FIND_PLACES_TOOL, { query: 'thai' }, context(down).ctx)).toEqual({ ok: false, error: down.message });
  });

  it('needs a query and a context that can look places up, and stays in the app', async () => {
    expect(await executeAskTool(FIND_PLACES_TOOL, {}, context(THAI).ctx)).toEqual({ ok: false, error: expect.stringContaining('query') });
    expect(await executeAskTool(FIND_PLACES_TOOL, { query: 'thai' }, context(null).ctx)).toEqual({
      ok: false,
      error: 'Places cannot be looked up from here.',
    });
    expect(IN_APP_ONLY_TOOLS).toContain(FIND_PLACES_TOOL);
    expect(lookupInScope(FIND_PLACES_TOOL, 'shopping')).toBe(true);
  });

  it('writes distances in metres under a kilometre and kilometres above', () => {
    expect(distanceText(null)).toBeNull();
    expect(distanceText(44)).toBe('40 m');
    expect(distanceText(1250)).toBe('1.3 km');
  });
});

describe('Ask Dash with find_places', () => {
  it('offers the lookup, runs it, and hands its places back to the model', async () => {
    const USAGE = { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const sent: { tools: { name: string }[]; messages: Anthropic.MessageParam[] }[] = [];
    const replies = [
      { content: [{ type: 'tool_use', id: 'p1', name: 'find_places', input: { query: 'thai restaurant' } }], stop_reason: 'tool_use', usage: USAGE },
      {
        content: [
          {
            type: 'tool_use',
            id: 'a1',
            name: 'answer',
            input: { answer: 'Kin Khao, 850 m away and open now: https://maps.google.com/?cid=111', cited: [] },
          },
        ],
        stop_reason: 'tool_use',
        usage: USAGE,
      },
    ];
    const client = {
      messages: {
        create: async (params: (typeof sent)[number]) => {
          sent.push(structuredClone(params));
          return replies[sent.length - 1];
        },
      },
    } as unknown as Anthropic;
    const { ctx } = context(THAI);

    const answer = await answerQuestion({
      turns: [{ role: 'user', body: 'Find me a Thai place near my house' }],
      today: '2026-11-06',
      execute: (name, input) => executeAskTool(name, input, ctx),
      anthropicApiKey: 'k',
      client,
    });

    expect(ASK_DASH_TOOLS.some((tool) => tool.name === FIND_PLACES_TOOL && tool.kind === 'lookup')).toBe(true);
    expect(sent[0].tools.map((t) => t.name)).toContain(FIND_PLACES_TOOL);
    const back = sent[1].messages.at(-1)?.content as Anthropic.ToolResultBlockParam[];
    expect(back[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'p1' });
    expect(back[0].is_error).toBeFalsy();
    expect(back[0].content).toContain('https://maps.google.com/?cid=111');
    expect(back[0].content).toContain('850 m');
    expect(answer).toMatchObject({ ok: true, body: expect.stringContaining('https://maps.google.com/?cid=111') });
  });
});

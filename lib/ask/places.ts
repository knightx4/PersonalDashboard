import type Anthropic from '@anthropic-ai/sdk';
import type { FoundPlace, PlacesLookupInput, PlacesLookupResult } from '@/lib/you/places-lookup';
import { AskInputError, optionalString, type AskContext, type AskToolResult } from './db';

/**
 * find_places (plan #2987.3): every chat looking up real places near home,
 * so "find me a Thai place near my house" has an answer with distances,
 * ratings, hours and a Maps link for each. People one-to-one threads and Ask
 * Dash reach it as one of Dash's lookups; a group chat's speakers are given
 * the same definition on its own (lib/you/group-burst.ts).
 *
 * The search is lib/you/places-lookup.ts, which keeps the daily cap, the
 * day's cache and the spend. It arrives on the context (`ctx.findPlaces`),
 * bound by lib/talk/ask-request.ts and a stub in tests, so this file only
 * reads the input and words the result. A refusal or a failure is handed
 * back with the lookup's own message as it is, for the chat to pass on.
 */

export const FIND_PLACES_TOOL = 'find_places';

export const FIND_PLACES_DEFINITION: Anthropic.Tool = {
  name: FIND_PLACES_TOOL,
  description:
    'Look up real places near the person\'s home on Google Maps, or near another address they name: "find me a Thai place near my house", "is there a pharmacy open now?", "a quiet café near the office on 5th Street". Returns up to 8 places, each with its address, straight-line distance, rating and how many ratings, price level, whether it is open now, today\'s hours and a Google Maps link. Use it for any question about where to go nearby rather than a web search. Then pick and answer in your own voice, as you would any text: name the one or few that fit, say why in a few words, and give the Maps link with each place you name. When it returns an error, tell them that sentence plainly and do not name places from memory.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'What kind of place, as they put it: "thai restaurant", "hardware store", "quiet café".',
      },
      near: {
        type: 'string',
        description: 'An address or place to search near instead of home ("Union Square", "350 5th Ave"). Leave out for near home.',
      },
      radius_meters: {
        type: 'number',
        description: 'How far to look, in metres. Leave out for about 2 km, which widens on its own when few places fall inside.',
      },
      open_now: { type: 'boolean', description: 'Only places open right now.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

/** The lookup's input, read from what the model sent. Throws AskInputError for a missing query. */
export function placesInput(input: Record<string, unknown>): PlacesLookupInput {
  const query = optionalString(input, 'query');
  if (!query) throw new AskInputError('Give what kind of place to look for as query, such as "thai restaurant".');
  const radius = input.radius_meters;
  return {
    query,
    near: optionalString(input, 'near'),
    radiusMeters: typeof radius === 'number' && Number.isFinite(radius) ? radius : null,
    openNow: input.open_now === true,
  };
}

const PRICES = ['free', '$', '$$', '$$$', '$$$$'] as const;

/** "850 m", "2.4 km". */
export function distanceText(meters: number | null): string | null {
  if (meters === null) return null;
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

/** One place as the model reads it. */
function placeFound(place: FoundPlace, isHome: boolean) {
  return {
    name: place.name,
    address: place.address,
    distance_from_home: distanceText(place.distanceMeters),
    ...(isHome ? {} : { distance_from_searched_place: distanceText(place.distanceFromNearMeters) }),
    rating: place.rating,
    ratings: place.ratingCount,
    price: place.priceLevel === null ? null : PRICES[place.priceLevel],
    open_now: place.openNow,
    today_hours: place.todayHours,
    maps_url: place.mapsUrl,
  };
}

/** The lookup's result as a tool result: places as `found`, a refusal or failure as its own message. */
export function placesToolResult(result: PlacesLookupResult): AskToolResult {
  if (result.status !== 'ok') return { ok: false, error: result.message };
  const near = result.center.isHome ? 'home' : result.center.label;
  const found = result.places.map((place) => placeFound(place, result.center.isHome));
  const within = distanceText(result.radiusMeters);
  return {
    ok: true,
    rows: [],
    found,
    totals: { places: found.length, near, within, widened: result.widened, as_of: result.fetchedAt },
    note:
      found.length === 0
        ? `No places matched within ${within} of ${near}. Say so, and offer to look further or for something else.`
        : `${found.length} places within ${within} of ${near}${result.widened ? ', after widening the search because few were closer' : ''}. ` +
          'Distances are straight-line, and open_now is as of as_of. Pick the ones that fit and answer in your own voice, ' +
          'giving the maps_url with each place you name.',
  };
}

export async function placesLookup(ctx: AskContext, input: Record<string, unknown>): Promise<AskToolResult> {
  if (!ctx.findPlaces) return { ok: false, error: 'Places cannot be looked up from here.' };
  return placesToolResult(await ctx.findPlaces(placesInput(input)));
}

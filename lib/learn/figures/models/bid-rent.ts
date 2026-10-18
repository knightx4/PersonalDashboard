import type { ExplorableModel, ModelValues } from './types';
import { BidRentPlot } from './bid-rent-plot';
import { type BidRentValues, cityEdge, km, officesEnd, rent, rentAt } from './bid-rent-curves';

/**
 * Bid-rent (plan #2321.8): rent against distance from a city's centre, with
 * sliders for the cost of commuting, households' income and a new rail line
 * out from the centre. Offices, homes and farms each bid for land; where one
 * outbids the next the land changes use, and the rent falls away from the
 * centre. For any lesson on the shape of a city: why land near the centre is
 * dear and built densely, why cities sprawl as commuting gets cheaper, what
 * a new line does to the land it serves.
 */

const RENT_OUT = 10;

function read(values: ModelValues): BidRentValues {
  return { commute: values.commute ?? 10, income: values.income ?? 40, rail: values.rail ?? 0 };
}

function railWords(value: number): string {
  return value === 0 ? 'No line' : `Out to ${value} km`;
}

function causes(now: BidRentValues, was: BidRentValues): string[] {
  const said: string[] = [];
  if (now.commute !== was.commute)
    said.push(`commuting costs £${now.commute} a km rather than £${was.commute}`);
  if (now.income !== was.income)
    said.push(`households earn £${now.income}k rather than £${was.income}k`);
  if (now.rail !== was.rail) {
    if (now.rail === 0) said.push('the rail line is gone');
    else if (was.rail === 0) said.push(`a rail line runs ${now.rail} km out`);
    else said.push(`the rail line runs ${now.rail} km out rather than ${was.rail}`);
  }
  return said;
}

function join(parts: string[]): string {
  if (parts.length < 2) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function same(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.05;
}

export const bidRentModel: ExplorableModel = {
  id: 'bid_rent',
  field: 'Urban economics',
  label: 'Bid-rent',
  teaches:
    'rent against distance from a city’s centre, where offices, homes and farms each bid for land and the highest bid wins it, so the land changes use where one line crosses the next and is built most densely where rent is highest. Sliders move the cost of commuting, households’ income and a rail line out from the centre. For the shape of a city: why central land is dear, why cities sprawl as commuting gets cheaper or incomes rise, what a new line does to the land it serves.',
  params: [
    {
      id: 'commute',
      label: 'Commuting cost',
      min: 6,
      max: 14,
      step: 2,
      start: 10,
      say: (value) => `£${value} a km`,
    },
    {
      id: 'income',
      label: 'Income',
      min: 30,
      max: 50,
      step: 5,
      start: 40,
      say: (value) => `£${value}k a year`,
    },
    { id: 'rail', label: 'Rail line', min: 0, max: 20, step: 5, start: 0, say: railWords },
  ],
  describe(values, from) {
    const now = read(values);
    const was = read(from);
    const edge = cityEdge(now);
    const said = causes(now, was);
    if (said.length === 0) {
      return `Offices outbid homes for the first ${km(officesEnd(now))}, homes outbid farms out to ${km(edge)}, and land ${RENT_OUT} km out rents for ${rent(rentAt(RENT_OUT, now))} a square metre. Move a slider to see the city spread or shrink.`;
    }
    const before = cityEdge(was);
    const edgeWords = same(edge, before)
      ? `the city’s edge stays at ${km(edge)}`
      : `the city’s edge moves ${edge > before ? 'out' : 'in'} from ${km(before)} to ${km(edge)}`;
    const r = rentAt(RENT_OUT, now);
    const rWas = rentAt(RENT_OUT, was);
    const rentWords = same(r, rWas)
      ? `land ${RENT_OUT} km out stays at ${rent(r)}`
      : `land ${RENT_OUT} km out ${r > rWas ? 'rises' : 'falls'} from ${rent(rWas)} to ${rent(r)}`;
    return `Now ${join(said)}, so ${edgeWords} and ${rentWords}.`;
  },
  readouts(values, from) {
    const now = read(values);
    const was = read(from);
    const pairs: Array<[string, number, number, (n: number) => string]> = [
      ['Offices end', officesEnd(now), officesEnd(was), km],
      ['City edge', cityEdge(now), cityEdge(was), km],
      [`Rent ${RENT_OUT} km out`, rentAt(RENT_OUT, now), rentAt(RENT_OUT, was), rent],
    ];
    return pairs.map(([label, value, before, say]) => ({
      label,
      value: say(value),
      was: same(value, before) ? null : say(before),
    }));
  },
  table(values) {
    const now = read(values);
    const end = officesEnd(now);
    const edge = cityEdge(now);
    const distances = [0, 5, 10, 15, 20, 30, 40, 50];
    return {
      head: ['Distance from the centre', 'Rent a square metre', 'Used for'],
      rows: distances.map((x) => [
        km(x),
        rent(rentAt(x, now)),
        x < end ? 'Offices' : x < edge ? 'Homes' : 'Farms',
      ]),
    };
  },
  measures: [
    {
      id: 'edge',
      label: 'the city’s edge',
      at: (values) => cityEdge(read(values)),
      words: { up: 'It moves out', down: 'It moves in', same: 'It stays where it is' },
    },
    {
      id: 'offices_end',
      label: 'where the offices end',
      at: (values) => officesEnd(read(values)),
      words: { up: 'It moves out', down: 'It moves in', same: 'It stays where it is' },
    },
    {
      id: 'rent_10km',
      label: `the rent on land ${RENT_OUT} km out`,
      at: (values) => rentAt(RENT_OUT, read(values)),
    },
  ],
  Plot: BidRentPlot,
  example: {
    caption:
      'A rail line opens out to the suburbs: move it and watch the rents along it and the city’s edge.',
    start: { commute: 10, income: 40, rail: 0 },
    moved: { commute: 10, income: 40, rail: 15 },
  },
};

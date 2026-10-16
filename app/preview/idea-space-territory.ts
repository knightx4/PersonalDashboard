import type { IdeaOnMap } from '@/lib/learn/map/load';
import type { SkyTerritory, TerritoryLinkIn, TerritoryStanding, TerritoryTopicIn } from '@/lib/learn/map/place-graph';
import { domainSlot } from '@/lib/learn/map/view';

/**
 * A goal's territory for the gallery (plan #2187.3): reading a SaaS
 * company's numbers, nine topics round the business field, with every state
 * a ladder can be in. One is tested past its target, one holds levels by
 * inference beyond what was tested, one has a missed level, two are not
 * started, and one is in the territory with no target. The requirement links
 * include one that a longer path already says, which is left off at rest.
 */

export const TERRITORY_GOAL = 'lens-saas';
/** The topic the territory is opened on in the gallery. */
export const TERRITORY_OPEN = 'tp-nrr';
/** The topic held pointed at in the hover shot: the one with the most links. */
export const TERRITORY_POINTED = 'tp-unit';

type Seed = Omit<TerritoryTopicIn, 'slot' | 'pca' | 'neighbourMap' | 'ideaIds'> & {
  /** Offset from the business field, in layout units. */
  d: { x: number; y: number };
  ideas: string[];
};

const SEEDS: Seed[] = [
  {
    id: 'tp-arr',
    name: 'Recurring revenue',
    ceiling: 8,
    tested: 4,
    held: 5,
    target: 6,
    missed: [],
    d: { x: -0.12, y: -0.04 },
    ideas: ['Annual recurring revenue', 'The rule of 40'],
  },
  {
    id: 'tp-churn',
    name: 'Churn and retention',
    ceiling: 8,
    tested: 3,
    held: 3,
    target: 6,
    missed: [4],
    d: { x: 0.1, y: -0.08 },
    ideas: ['Churn compounds monthly', 'Cohort analysis of retention'],
  },
  {
    id: 'tp-nrr',
    name: 'Net revenue retention',
    ceiling: 7,
    tested: 0,
    held: 2,
    target: 5,
    missed: [],
    d: { x: 0, y: 0.06 },
    ideas: ['Net revenue retention above 100%', 'Annual recurring revenue', 'Cohort analysis of retention'],
  },
  {
    id: 'tp-cac',
    name: 'Customer acquisition cost',
    ceiling: 8,
    tested: 2,
    held: 2,
    target: 5,
    missed: [],
    d: { x: 0.18, y: 0.1 },
    ideas: ['Customer acquisition cost payback', 'Lifetime value to CAC ratio'],
  },
  {
    id: 'tp-ltv',
    name: 'Lifetime value',
    ceiling: 8,
    tested: 0,
    held: 0,
    target: 5,
    missed: [],
    d: { x: 0.08, y: 0.16 },
    ideas: ['Lifetime value to CAC ratio', 'Churn compounds monthly', 'Contribution margin per unit'],
  },
  {
    id: 'tp-unit',
    name: 'Unit economics of a subscription business',
    ceiling: 9,
    tested: 0,
    held: 0,
    target: 4,
    missed: [],
    d: { x: 0.14, y: 0.24 },
    ideas: ['Contribution margin per unit', 'Lifetime value to CAC ratio', 'Customer acquisition cost payback'],
  },
  {
    id: 'tp-margin',
    name: 'Gross margin',
    ceiling: 6,
    tested: 5,
    held: 6,
    target: 4,
    missed: [],
    d: { x: -0.06, y: 0.2 },
    ideas: ['Gross margin of a software business', 'Contribution margin per unit'],
  },
  {
    id: 'tp-rule40',
    name: 'The rule of 40',
    ceiling: 6,
    tested: 0,
    held: 0,
    target: 3,
    missed: [],
    d: { x: -0.2, y: 0.12 },
    ideas: ['The rule of 40', 'Burn multiple'],
  },
  {
    id: 'tp-burn',
    name: 'Burn multiple',
    ceiling: 6,
    tested: 1,
    held: 1,
    target: null,
    missed: [],
    d: { x: -0.24, y: -0.02 },
    ideas: ['Burn multiple', 'Working capital ties up cash'],
  },
];

/** `requiring` at a level needs `required` at a level. */
const LINKS: [string, number, string, number][] = [
  ['tp-nrr', 3, 'tp-arr', 3],
  ['tp-nrr', 3, 'tp-churn', 3],
  ['tp-nrr', 5, 'tp-churn', 4],
  ['tp-ltv', 2, 'tp-churn', 4],
  ['tp-ltv', 2, 'tp-margin', 2],
  ['tp-ltv', 3, 'tp-arr', 2],
  ['tp-unit', 2, 'tp-ltv', 3],
  ['tp-unit', 2, 'tp-cac', 3],
  ['tp-unit', 3, 'tp-margin', 3],
  // Already said through Lifetime value, so drawn only while pointed at.
  ['tp-unit', 4, 'tp-arr', 2],
  ['tp-rule40', 2, 'tp-arr', 4],
  ['tp-rule40', 2, 'tp-margin', 3],
  ['tp-burn', 2, 'tp-arr', 3],
];

/**
 * What you are ready for inside the goal, in the order the engine would ask
 * it (plan #2187.4): the missed level first, then what settles most. Burn
 * multiple has no target, so it is not on the route.
 */
const READY: [string, number][] = [
  ['tp-churn', 4],
  ['tp-nrr', 3],
  ['tp-arr', 6],
  ['tp-cac', 3],
  ['tp-ltv', 1],
  ['tp-rule40', 1],
  ['tp-unit', 1],
];

const DAY_MS = 86_400_000;
/** The day the gallery's Idea Space stands on (idea-space-surfaces.tsx AS_OF). */
const TODAY = Date.parse('2026-10-13T12:00:00Z');

/**
 * Why each topic with a level held stands there (plan #2187.5): answers with
 * the words that showed them, a level held by inference from an answer on
 * another topic, one with no quote, one overdue a re-check.
 */
const STANDING: [string, TerritoryStanding['how'], number, number, string | null, TerritoryStanding['via']][] = [
  ['tp-arr', 'inferred', 5, 12, null, { topicName: 'Gross margin', level: 5 }],
  [
    'tp-churn',
    'tested',
    3,
    45,
    'Two percent a month sounds small, but it compounds: a thousand customers become about 780 after a year, so the base shrinks unless sales replace them.',
    null,
  ],
  [
    'tp-nrr',
    'inferred',
    2,
    20,
    'Net revenue retention above 100% means the customers who stay spend more than the ones who leave.',
    { topicName: 'Recurring revenue', level: 3 },
  ],
  ['tp-cac', 'tested', 2, 5, 'Payback is the months of gross margin it takes to earn back what a customer cost to win.', null],
  ['tp-margin', 'inferred', 6, 33, null, { topicName: 'Unit economics of a subscription business', level: 3 }],
  ['tp-burn', 'tested', 1, 9, null, null],
];

/** A cell's id, as Practice wants one. */
const cellId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Where the business field sits in each layout (idea-space-surfaces.tsx FIELDS). */
const FIELD = { neighbourMap: { x: -0.1, y: 0.7 }, pca: { x: 0.05, y: 0.45 } };

export function territoryFixture(ideas: readonly IdeaOnMap[]): SkyTerritory {
  const byName = new Map(ideas.map((idea) => [idea.name, idea.id]));
  const slot = domainSlot('Social sciences');
  const topics: TerritoryTopicIn[] = SEEDS.map(({ d, ideas: names, ...seed }) => ({
    ...seed,
    slot,
    neighbourMap: { x: FIELD.neighbourMap.x + d.x, y: FIELD.neighbourMap.y - d.y },
    pca: { x: FIELD.pca.x + d.x * 0.8, y: FIELD.pca.y - d.y * 0.8 },
    ideaIds: names.map((name) => byName.get(name)).filter((id): id is string => id !== undefined),
  }));
  const links: TerritoryLinkIn[] = LINKS.map(([a, at, b, needs]) => ({
    requiringTopicId: a,
    requiringLevel: at,
    requiredTopicId: b,
    requiredLevel: needs,
  }));
  const ready = READY.map(([topicId, level], i) => ({
    topicId,
    level,
    cellId: cellId(i + 1),
    why:
      i === 0
        ? 'Missed before, and what it needs is held now, and opens 2 more levels.'
        : 'What it needs is held, so it can start here, and opens 1 more level.',
  }));
  const standing: TerritoryStanding[] = STANDING.map(([topicId, how, level, daysAgo, quote, via], i) => {
    const since = new Date(TODAY - daysAgo * DAY_MS).toISOString();
    return {
      topicId,
      how,
      level,
      cellId: cellId(100 + i),
      since,
      dueOn: new Date(TODAY - daysAgo * DAY_MS + 30 * DAY_MS).toISOString(),
      quote,
      via,
    };
  });
  return { id: TERRITORY_GOAL, name: 'Read a SaaS company’s numbers', topics, links, ready, standing };
}

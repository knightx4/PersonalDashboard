import type { CellEvidence } from '@/lib/learn/levels/model';
import type { GoalOnMap, GoalStar } from '@/lib/learn/map/goals';
import type { IdeaOnMap } from '@/lib/learn/map/load';
import type { StrengthInput } from '@/lib/learn/strength';
import type { SkyTerritory, TerritoryLinkIn, TerritoryStanding, TerritoryTopicIn } from '@/lib/learn/map/place-graph';
import type { GoalLevels } from '@/lib/learn/map/panels';
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
/** The topic held pointed at in the hover shot: the one most others need, tested and held apart. */
export const TERRITORY_POINTED = 'tp-arr';

type Seed = Omit<TerritoryTopicIn, 'slot' | 'pca' | 'neighbourMap' | 'ideaIds'> & {
  /** Offset from the business field, in layout units. */
  d: { x: number; y: number };
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

const SUBJECT = 'Read a SaaS company’s numbers';

function placed(d: { x: number; y: number }) {
  return {
    neighbourMap: { x: FIELD.neighbourMap.x + d.x, y: FIELD.neighbourMap.y - d.y },
    pca: { x: FIELD.pca.x + d.x * 0.8, y: FIELD.pca.y - d.y * 0.8 },
  };
}

/** The claims-graph ideas attached to some of the territory's topics, as the card lists them. */
const IDEAS_UNDER: Record<string, string[]> = {
  'tp-arr': ['Annual recurring revenue is twelve times the monthly run rate', 'One-off fees are left out of recurring revenue'],
  'tp-churn': ['Churn compounds monthly', 'A cohort chart shows churn by the month customers joined'],
  'tp-nrr': [
    'Net revenue retention above 100% means the base grows without new customers',
    'Expansion revenue can hide logo churn',
    'NRR is measured over a twelve-month cohort',
  ],
  'tp-cac': ['CAC payback is months of gross margin per customer won'],
  'tp-margin': ['Software gross margin is high because copies cost almost nothing'],
};

/**
 * The territory's topics as stars on the sky (plan #2317.2): each lit from
 * its ladder as the loader lights it, with the ideas of IDEAS_UNDER under
 * it. Strength, haze and the halo are left for the fixture to work out with
 * the rest of the sky; neighbours too.
 */
export function territoryStars(): IdeaOnMap[] {
  const since = new Map(STANDING.map(([topicId, , , daysAgo]) => [topicId, new Date(TODAY - daysAgo * DAY_MS).toISOString()]));
  return SEEDS.map((seed) => {
    const at = since.get(seed.id) ?? new Date(TODAY - 20 * DAY_MS).toISOString();
    const share = Math.max(seed.tested, seed.held) / seed.ceiling;
    const state = share >= 0.85 ? 'sharp' : share >= 0.5 ? 'known' : share > 0 ? 'recognised' : 'unknown';
    const stateRow: StrengthInput | null =
      seed.tested > 0
        ? { state, established: 'tested', tested_at: at, declared_at: null, review_interval_days: null }
        : seed.held > 0
          ? { state, established: 'inferred', tested_at: null, declared_at: at, review_interval_days: null }
          : null;
    return {
      id: seed.id,
      name: seed.name,
      claim: `${seed.name}: what the topic covers, as the preparation scoped it, in a sentence or two.`,
      state,
      stateRow,
      strength: 0,
      haze: 0,
      exposure: 0,
      placeId: TERRITORY_GOAL,
      createdAt: new Date(TODAY - 60 * DAY_MS).toISOString(),
      evidence: [],
      ...placed(seed.d),
      neighbours: [],
      track: { id: TERRITORY_GOAL, name: SUBJECT },
      field: { id: 'f-business', name: 'Business and management' },
      domain: { id: 'social', name: 'Social sciences' },
      levels: { tested: seed.tested, held: Math.max(seed.held, seed.tested), ceiling: seed.ceiling },
      ideasUnder: (IDEAS_UNDER[seed.id] ?? []).map((name, i) => ({ id: `${seed.id}-idea-${i}`, name })),
    };
  });
}

/** The territory as the subjects card lists it, with the goal that reads it. */
export function territoryGoal(): GoalOnMap {
  const stars: GoalStar[] = SEEDS.flatMap((seed) =>
    seed.target === null
      ? []
      : [{ topicId: seed.id, name: seed.name, targetLevel: seed.target, level: seed.held, ...placed(seed.d) }],
  );
  const held = SEEDS.reduce((n, s) => n + (s.target === null ? 0 : Math.min(s.held, s.target)), 0);
  const total = SEEDS.reduce((n, s) => n + (s.target ?? 0), 0);
  const on = new Set(stars.map((s) => s.topicId));
  const seen = new Set<string>();
  const links = LINKS.flatMap(([a, , b]) => {
    const key = [a, b].sort().join('|');
    if (!on.has(a) || !on.has(b) || seen.has(key)) return [];
    seen.add(key);
    return [{ from: a, to: b }];
  });
  return {
    id: TERRITORY_GOAL,
    name: SUBJECT,
    goalNames: ['Move into strategy and operations at a SaaS company'],
    line: `${SEEDS.length} topics · ${held} of ${total} levels held`,
    held,
    total,
    next: 'Next: Churn and retention at level 4, work out a case with it',
    stars,
    links,
  };
}

export function territoryFixture(): SkyTerritory {
  const slot = domainSlot('Social sciences');
  // The ideas under each topic are listed in its card, never drawn round the edge (plan #2317.2).
  const topics: TerritoryTopicIn[] = SEEDS.map((s) => ({
    id: s.id,
    name: s.name,
    ceiling: s.ceiling,
    tested: s.tested,
    held: s.held,
    target: s.target,
    missed: s.missed,
    slot,
    ...placed(s.d),
    ideaIds: [],
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
  return { id: TERRITORY_GOAL, name: SUBJECT, topics, links, ready, standing };
}

/**
 * The same territory as the topic map the panels under the map read (plan
 * #2187.6): a cell for every level up to each ceiling, the links above, and
 * evidence that gives each ladder its tested, held and missed levels. The
 * top answers land over the last seven weeks and an earlier, lower one five
 * weeks before that, so four weeks back reads lower than today. The thin one
 * is the live goal: every topic a draft, one link, no evidence.
 */
export function territoryLevels(asOf: string, options: { thin?: boolean } = {}): GoalLevels {
  const now = new Date(asOf).getTime();
  const daysAgo = (n: number) => new Date(now - n * 86_400_000).toISOString();
  const cell = (topicId: string, level: number) => `cell-${topicId}-${level}`;
  const topics = SEEDS.map((seed) => ({ id: seed.id, name: seed.name, ceiling: seed.ceiling, approved: !options.thin }));
  const cells = SEEDS.flatMap((seed) =>
    Array.from({ length: seed.ceiling }, (_, i) => ({ id: cell(seed.id, i + 1), topicId: seed.id, level: i + 1 })),
  );
  const links = (options.thin ? LINKS.slice(0, 1) : LINKS).map(([a, at, b, needs]) => ({
    requiringCellId: cell(a, at),
    requiredCellId: cell(b, needs),
  }));
  const evidence: CellEvidence[] = [];
  if (!options.thin) {
    SEEDS.forEach((seed, i) => {
      const recent = 4 + i * 5;
      if (seed.tested > 0) {
        evidence.push({ cellId: cell(seed.id, seed.tested), verdict: 'met', observedAt: daysAgo(recent) });
        if (seed.tested > 2 && i % 2 === 0) {
          evidence.push({ cellId: cell(seed.id, seed.tested - 2), verdict: 'met', observedAt: daysAgo(recent + 35) });
        }
      }
      if (seed.held > seed.tested) {
        evidence.push({ cellId: cell(seed.id, seed.held), verdict: 'declared', observedAt: daysAgo(recent + 1) });
      }
      for (const level of seed.missed) {
        evidence.push({ cellId: cell(seed.id, level), verdict: 'not_met', observedAt: daysAgo(recent) });
      }
    });
  }
  return {
    map: { topics, cells, links, evidence },
    lenses: [
      {
        id: TERRITORY_GOAL,
        name: SUBJECT,
        targets: SEEDS.flatMap((seed) => (seed.target === null ? [] : [{ topicId: seed.id, targetLevel: seed.target }])),
      },
    ],
  };
}

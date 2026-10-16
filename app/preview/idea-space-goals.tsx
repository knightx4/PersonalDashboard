import type { GoalLink, GoalOnMap, GoalStar } from '@/lib/learn/map/goals';
import type { IdeaOnMap } from '@/lib/learn/map/load';

/**
 * Learning goals for the Idea Space gallery (plan #2187.2): three open
 * goals, the first with a dozen topics whose names are as long as the live
 * ones, a second at a familiar depth, and a third whose topics are all
 * drafts. Each topic sits beside an idea of the fixture, as the scope's
 * embedding would put it near the ideas it is about.
 */

type Seed = { name: string; target: number; level: number };

const SAAS: Seed[] = [
  { name: 'Recurring revenue: MRR and ARR', target: 5, level: 4 },
  { name: 'ARR bridge (new, expansion, contraction and churn)', target: 6, level: 2 },
  { name: 'Net revenue retention and negative churn', target: 6, level: 3 },
  { name: 'Logo churn and gross revenue churn', target: 5, level: 3 },
  { name: 'Customer acquisition cost (CAC)', target: 5, level: 2 },
  { name: 'Customer lifetime value (LTV)', target: 5, level: 2 },
  { name: 'SaaS unit economics: LTV to CAC and CAC payback', target: 6, level: 1 },
  { name: 'SaaS growth rate', target: 5, level: 2 },
  { name: 'Gross margin in software', target: 4, level: 1 },
  { name: 'SaaS revenue recognition and deferred revenue', target: 5, level: 0 },
  { name: 'Burn rate and the SaaS cash flow trough', target: 5, level: 0 },
  { name: 'SaaS metrics dashboard and benchmarks', target: 4, level: 0 },
];

/** Which topic needs which, by index into SAAS. */
const SAAS_LINKS: [number, number][] = [
  [1, 0],
  [2, 1],
  [3, 1],
  [6, 4],
  [6, 5],
  [5, 3],
  [7, 0],
  [11, 6],
  [11, 7],
  [9, 0],
  [10, 8],
];

const ACCOUNTS: Seed[] = [
  { name: 'The three financial statements', target: 2, level: 2 },
  { name: 'Accrual accounting', target: 2, level: 1 },
  { name: 'Working capital', target: 2, level: 1 },
  { name: 'Depreciation and amortisation', target: 2, level: 0 },
  { name: 'Free cash flow', target: 2, level: 0 },
  { name: 'Reading the notes to the accounts', target: 2, level: 0 },
];

function starsAt(seeds: readonly Seed[], ideas: readonly IdeaOnMap[], from: number, prefix: string): GoalStar[] {
  return seeds.map((seed, i) => {
    const idea = ideas[(from + i * 7) % ideas.length]!;
    return {
      topicId: `${prefix}-${i}`,
      name: seed.name,
      targetLevel: seed.target,
      level: seed.level,
      pca: { x: idea.pca.x + 0.012, y: idea.pca.y - 0.01 },
      neighbourMap: { x: idea.neighbourMap.x + 0.012, y: idea.neighbourMap.y - 0.01 },
    };
  });
}

function heldOf(seeds: readonly Seed[]): { held: number; total: number } {
  return {
    held: seeds.reduce((n, s) => n + Math.min(s.level, s.target), 0),
    total: seeds.reduce((n, s) => n + s.target, 0),
  };
}

/**
 * The three goals, their topics beside `ideas` (the business ideas of the
 * fixture, or one region of the dense sky), in the order the lenses come.
 */
export function goalsFor(ideas: readonly IdeaOnMap[]): GoalOnMap[] {
  const saas = starsAt(SAAS, ideas, 0, 'saas');
  const accounts = starsAt(ACCOUNTS, ideas, 3, 'accounts');
  const links = (stars: GoalStar[], pairs: [number, number][]): GoalLink[] =>
    pairs.map(([a, b]) => ({ from: stars[a]!.topicId, to: stars[b]!.topicId }));
  const s = heldOf(SAAS);
  const a = heldOf(ACCOUNTS);
  return [
    {
      id: 'goal-behavioural',
      name: 'Behavioural economics for pricing',
      line: '5 draft topics to approve',
      held: 0,
      total: 0,
      next: null,
      stars: [],
      links: [],
    },
    {
      id: 'goal-accounts',
      name: "Read a company's accounts",
      line: `${ACCOUNTS.length} topics · ${a.held} of ${a.total} levels held`,
      ...a,
      next: 'Next: Accrual accounting at level 2, define it accurately in your own words',
      stars: accounts,
      links: links(accounts, [
        [1, 0],
        [2, 1],
        [4, 2],
        [3, 0],
      ]),
    },
    {
      id: 'goal-saas',
      name: 'SaaS and subscription business metrics',
      line: `${SAAS.length} topics · ${s.held} of ${s.total} levels held`,
      ...s,
      next: 'Next: Gross margin in software at level 2, define it accurately in your own words',
      stars: saas,
      links: links(saas, SAAS_LINKS),
    },
  ];
}

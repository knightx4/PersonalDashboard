import { IdeaSpaceView } from '@/app/learn/space/idea-space-view';
import type { KnowledgeState } from '@/lib/learn/graph/model';
import type { IdeaMapView, IdeaOnMap } from '@/lib/learn/map/load';
import type { Point } from '@/lib/learn/map/layout';
import { DEFAULT_PARAMS } from '@/lib/learn/map/view';

/**
 * Fixtures for the Idea Space page (plan #1857).
 *
 * About a hundred and thirty ideas in clusters by field, most of them in the
 * social sciences as the person's are, with every state, two ideas with no
 * domain, a field projected outside the map's square, and fields no idea is
 * in yet. Positions come from a fixed seed, so every shot draws the same map.
 */

type FieldSeed = {
  id: string;
  name: string;
  domain: string;
  /** Where its ideas gather, in each layout. */
  at: Point;
  axes: Point;
  ideas: string[];
};

const DOMAINS: Record<string, string> = {
  social: 'Social sciences',
  history: 'History',
  tech: 'Technology and engineering',
  life: 'Life sciences',
  philosophy: 'Philosophy and religion',
  language: 'Language and literature',
  health: 'Health and medicine',
  physical: 'Physical sciences',
  arts: 'Arts and culture',
  maths: 'Mathematics and logic',
};

const FIELDS: FieldSeed[] = [
  {
    id: 'f-econ',
    name: 'Economics',
    domain: 'social',
    at: { x: -0.45, y: 0.35 },
    axes: { x: -0.2, y: 0.25 },
    ideas: [
      'Comparative advantage',
      'Opportunity cost',
      'Price elasticity of demand',
      'Marginal utility falls as you consume more',
      'Sunk costs should not change a decision',
      'Moral hazard after insurance',
      'Adverse selection in used car markets',
      'The Phillips curve shifts with expectations',
      'Money is neutral in the long run',
      'Inflation targeting anchors expectations',
      'Deadweight loss from a tax',
      'Tax incidence falls on the less elastic side',
      'Public goods are non-rival and non-excludable',
      'Tragedy of the commons',
      'Network effects raise the value of each user',
      'Switching costs lock customers in',
      'Price discrimination by willingness to pay',
      'Monopsony power in labour markets',
      'Rent seeking wastes resources',
      'Diminishing returns to a fixed input',
      'Economies of scale lower unit cost',
      'Real versus nominal interest rates',
    ],
  },
  {
    id: 'f-business',
    name: 'Business and management',
    domain: 'social',
    at: { x: -0.1, y: 0.7 },
    axes: { x: 0.05, y: 0.45 },
    ideas: [
      'Annual recurring revenue',
      'Net revenue retention above 100%',
      'Customer acquisition cost payback',
      'Lifetime value to CAC ratio',
      'Gross margin of a software business',
      'Churn compounds monthly',
      'The rule of 40',
      'Burn multiple',
      'Cohort analysis of retention',
      'Contribution margin per unit',
      'Working capital ties up cash',
      'Three-statement model links',
      'Discounted cash flow valuation',
      'Terminal value dominates a DCF',
      'Sensitivity tables in a model',
      'Circular references in interest calculations',
      'INDEX and MATCH over VLOOKUP',
      'Scenario switches in a model',
    ],
  },
  {
    id: 'f-psych',
    name: 'Psychology',
    domain: 'social',
    at: { x: -0.75, y: -0.05 },
    axes: { x: -0.45, y: -0.1 },
    ideas: [
      'Loss aversion',
      'Anchoring on the first number',
      'The availability heuristic',
      'Spacing effect in memory',
      'Retrieval practice beats rereading',
      'Desirable difficulties',
      'Confirmation bias',
      'The fundamental attribution error',
      'Hyperbolic discounting',
      'Habit loops of cue, routine and reward',
      'Learned helplessness',
      'The Big Five traits are stable in adults',
    ],
  },
  {
    id: 'f-politics',
    name: 'Political science',
    domain: 'social',
    at: { x: -0.25, y: -0.3 },
    axes: { x: -0.1, y: -0.35 },
    ideas: [
      "Median voter theorem",
      "Arrow's impossibility theorem",
      'Principal-agent problems in government',
      'Regulatory capture',
      "Duverger's law",
      'Collective action problems',
    ],
  },
  {
    id: 'f-history',
    name: 'Modern history',
    domain: 'history',
    at: { x: 0.2, y: -0.6 },
    axes: { x: 0.1, y: -0.55 },
    ideas: [
      'The Bretton Woods system',
      'The Marshall Plan rebuilt Western Europe',
      'The Great Depression deepened under the gold standard',
      'Stagflation in the 1970s',
      'The fall of the Berlin Wall',
      'Decolonisation after 1945',
      'The Industrial Revolution began in textiles',
      'The Treaty of Versailles and reparations',
      'The Cold War arms race',
      'The 2008 financial crisis',
    ],
  },
  {
    id: 'f-computing',
    name: 'Computer science',
    domain: 'tech',
    at: { x: 0.6, y: 0.45 },
    axes: { x: 0.55, y: 0.3 },
    ideas: [
      'Big O describes growth, not speed',
      'Hash tables give constant-time lookup on average',
      'Embeddings place meaning in vector space',
      'Cosine similarity ignores length',
      'Principal components keep the most variance',
      'Gradient descent follows the slope down',
      'Overfitting memorises noise',
      'Indexes trade write speed for read speed',
      'Idempotent requests can be retried',
    ],
  },
  {
    id: 'f-biology',
    name: 'Biology',
    domain: 'life',
    at: { x: 0.65, y: -0.2 },
    axes: { x: 0.35, y: -0.15 },
    ideas: [
      'Natural selection acts on variation',
      'Genes are expressed, not just carried',
      'Homeostasis by negative feedback',
      'The mitochondrion makes ATP',
      'Sleep consolidates memory',
      'Evolutionary arms races',
      'Kin selection explains some altruism',
      'Circadian rhythms set by light',
    ],
  },
  {
    id: 'f-philosophy',
    name: 'Philosophy',
    domain: 'philosophy',
    at: { x: -0.7, y: -0.6 },
    axes: { x: -0.35, y: -0.6 },
    ideas: [
      'The is-ought gap',
      'Utilitarianism weighs outcomes',
      "Kant's categorical imperative",
      'The veil of ignorance',
      'Stoic dichotomy of control',
      'Falsifiability marks science',
    ],
  },
  {
    id: 'f-literature',
    name: 'Literature',
    domain: 'language',
    at: { x: 0.1, y: 0.05 },
    axes: { x: 0.0, y: 0.0 },
    ideas: ['The unreliable narrator', "Chekhov's gun", 'Free indirect speech'],
  },
  {
    id: 'f-medicine',
    name: 'Medicine',
    domain: 'health',
    at: { x: 0.85, y: 0.05 },
    axes: { x: 0.5, y: 0.0 },
    ideas: ['Number needed to treat', 'Base rates in diagnostic tests'],
  },
  {
    id: 'f-physics',
    name: 'Physics',
    domain: 'physical',
    at: { x: 0.3, y: 0.85 },
    axes: { x: 0.7, y: 0.65 },
    ideas: ['Entropy rises in a closed system', 'Energy is conserved'],
  },
  {
    id: 'f-maths',
    name: 'Mathematics',
    domain: 'maths',
    at: { x: 0.35, y: 0.2 },
    axes: { x: 0.3, y: 0.15 },
    ideas: ["Bayes' theorem updates a prior", 'Regression to the mean', 'Compound growth is exponential'],
  },
  // Fields nobody has been to: placed by their own description.
  { id: 'f-music', name: 'Music', domain: 'arts', at: { x: 0.85, y: -0.75 }, axes: { x: 0.8, y: -0.7 }, ideas: [] },
  { id: 'f-chemistry', name: 'Chemistry', domain: 'physical', at: { x: 0.9, y: 0.75 }, axes: { x: 1.35, y: 0.5 }, ideas: [] },
  { id: 'f-law', name: 'Law', domain: 'social', at: { x: -0.85, y: 0.75 }, axes: { x: -0.7, y: 0.7 }, ideas: [] },
  { id: 'f-linguistics', name: 'Linguistics', domain: 'language', at: { x: -0.05, y: -0.9 }, axes: { x: -0.05, y: -0.85 }, ideas: [] },
];

/** A fixed sequence, so every shot draws the same map. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const STATES: KnowledgeState[] = [
  'unknown', 'unknown', 'unknown', 'unknown', 'unknown',
  'recognised', 'shaky', 'recognised',
  'known', 'known', 'sharp', 'known',
  'misconception',
];

function fixture(): IdeaMapView {
  const random = seeded(1857);
  const jitter = (spread: number) => (random() - 0.5) * 2 * spread;
  const clamp = (n: number) => Math.max(-1, Math.min(1, n));

  const ideas: IdeaOnMap[] = [];
  let n = 0;
  for (const field of FIELDS) {
    for (const name of field.ideas) {
      n += 1;
      const id = `idea-${String(n).padStart(3, '0')}`;
      ideas.push({
        id,
        name,
        claim: `${name}: the claim as Learn wrote it, one or two sentences long, which the rail shows under the name so the idea can be read without opening it.`,
        state: STATES[Math.floor(random() * STATES.length)]!,
        pca: { x: clamp(1.3 * (field.axes.x + jitter(0.28))), y: clamp(1.3 * (field.axes.y + jitter(0.28))) },
        neighbourMap: { x: clamp(field.at.x + jitter(0.24)), y: clamp(field.at.y + jitter(0.24)) },
        neighbours: [],
        track: { id: `s-${field.id}`, name: field.id === 'f-business' ? 'SaaS metrics and Excel modelling' : field.name },
        field: { id: field.id, name: field.name },
        domain: { id: field.domain, name: DOMAINS[field.domain]! },
      });
    }
  }
  // Two ideas written before the fields were catalogued: no field, no domain.
  for (const name of ['Write the summary before the detail', 'A checklist beats memory under stress']) {
    n += 1;
    ideas.push({
      id: `idea-${String(n).padStart(3, '0')}`,
      name,
      claim: `${name}, as Learn wrote it.`,
      state: 'unknown',
      pca: { x: jitter(0.6), y: jitter(0.6) },
      neighbourMap: { x: 0.45 + jitter(0.1), y: -0.85 + jitter(0.1) },
      neighbours: [],
      track: null,
      field: null,
      domain: null,
    });
  }

  // Six nearest by distance on the neighbour map, with a similarity that falls with it.
  for (const idea of ideas) {
    idea.neighbours = ideas
      .filter((other) => other.id !== idea.id)
      .map((other) => ({
        id: other.id,
        d: Math.hypot(other.neighbourMap.x - idea.neighbourMap.x, other.neighbourMap.y - idea.neighbourMap.y),
      }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 6)
      .map(({ id, d }) => ({ id, similarity: Math.max(0.42, 0.93 - d * 0.9) }));
  }

  const byName = new Map(ideas.map((idea) => [idea.name, idea.id]));
  const pair = (a: string, b: string, similarity: number) => ({ a: byName.get(a)!, b: byName.get(b)!, similarity });
  const known = new Set(['known', 'sharp']);

  const fieldIdeas = (id: string) => ideas.filter((idea) => idea.field?.id === id).length;
  const fields = FIELDS.map((field) => ({
    id: field.id,
    domainId: field.domain,
    name: field.name,
    domain: { id: field.domain, name: DOMAINS[field.domain]! },
    ideaCount: fieldIdeas(field.id),
    pca: field.axes,
    neighbourMap: field.at,
  }));
  const domains = Object.entries(DOMAINS).map(([id, name]) => {
    const own = fields.filter((field) => field.domainId === id);
    const count = own.length;
    const mean = (pick: (f: (typeof own)[number]) => Point): Point => ({
      x: own.reduce((sum, f) => sum + pick(f).x, 0) / count,
      y: own.reduce((sum, f) => sum + pick(f).y, 0) / count,
    });
    return {
      id,
      name,
      fields: own.length,
      ideaCount: own.reduce((sum, f) => sum + f.ideaCount, 0),
      pca: mean((f) => f.pca),
      neighbourMap: mean((f) => f.neighbourMap),
    };
  });

  return {
    ideas,
    variance: { first: 0.087, second: 0.054 },
    projection: {
      mean: [],
      components: [[], []],
      variance: [0.087, 0.054],
      frame: { cx: 0, cy: 0, scale: 1 },
    },
    similarPairs: [
      pair('Annual recurring revenue', 'Net revenue retention above 100%', 0.91),
      pair('Spacing effect in memory', 'Retrieval practice beats rereading', 0.9),
      pair('Customer acquisition cost payback', 'Lifetime value to CAC ratio', 0.89),
      pair('Discounted cash flow valuation', 'Terminal value dominates a DCF', 0.88),
      pair('Network effects raise the value of each user', 'Switching costs lock customers in', 0.87),
      pair('Moral hazard after insurance', 'Adverse selection in used car markets', 0.86),
    ],
    untestedNearKnown: ideas
      .filter((idea) => idea.state === 'unknown')
      .map((idea) => ({
        id: idea.id,
        known: idea.neighbours.filter((neighbour) =>
          known.has(ideas.find((other) => other.id === neighbour.id)!.state),
        ),
      }))
      .filter((row) => row.known.length >= 3)
      .sort((a, b) => b.known.length - a.known.length),
    areas: { fields, domains, fieldsMissing: 31 },
    missing: 3,
  };
}

const VIEW = fixture();
const OPEN = VIEW.ideas.find((idea) => idea.name === 'Price elasticity of demand')!.id;

/** Neighbour map by state, field names on, one idea open with its nearest six. */
export function IdeaSpaceSurface() {
  return <IdeaSpaceView view={VIEW} params={{ ...DEFAULT_PARAMS, labels: true, idea: OPEN }} />;
}

/**
 * The map as it is live today: the fields not placed yet, so there are no
 * names to turn on, drawn on the axes layout and coloured by domain.
 */
export function IdeaSpaceDomainsSurface() {
  const view: IdeaMapView = {
    ...VIEW,
    areas: { fields: [], domains: [], fieldsMissing: 47 },
    missing: 0,
  };
  return <IdeaSpaceView view={view} params={{ ...DEFAULT_PARAMS, layout: 'axes', colour: 'domain' }} />;
}

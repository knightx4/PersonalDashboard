'use client';

import { useMemo } from 'react';
import { IdeaSpaceView } from '@/app/learn/space/idea-space-view';
import type { KnowledgeState, StateBasis } from '@/lib/learn/graph/model';
import type { IdeaMapView, IdeaOnMap, PlaceOnMap } from '@/lib/learn/map/load';
import type { Point } from '@/lib/learn/map/layout';
import { lightOn } from '@/lib/learn/map/sky';
import { stateSetAt, type StrengthInput } from '@/lib/learn/strength';
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

/** The day the fixtures are lit for, so every shot draws the same brightness. */
const AS_OF = new Date('2026-10-13T12:00:00Z');
const DAY_MS = 86_400_000;

/** A state row for a fixture idea: tested or declared some days before AS_OF, a few with a review. */
function stateRowFor(state: KnowledgeState, random: () => number): StrengthInput | null {
  if (state === 'unknown') return null;
  const established: StateBasis = random() < 0.55 ? 'tested' : random() < 0.8 ? 'declared' : 'inferred';
  const at = new Date(AS_OF.getTime() - Math.floor(random() * 120) * DAY_MS).toISOString();
  return {
    state,
    established,
    tested_at: established === 'tested' ? at : null,
    declared_at: established === 'declared' ? at : null,
    review_interval_days: established === 'tested' && random() < 0.4 ? 21 : null,
  };
}

/**
 * When each fixture idea was written, for the timeline (plan #1997.8): a few
 * days before its state was set, or any day in the last four months for an
 * idea not known yet. A sequence of its own, so the map's layout is unchanged.
 */
function withCreated(ideas: IdeaOnMap[], seed: number): void {
  const random = seeded(seed);
  for (const idea of ideas) {
    const set = idea.stateRow ? stateSetAt(idea.stateRow) : null;
    const at = set ? set.getTime() - Math.floor(random() * 7) * DAY_MS : AS_OF.getTime() - Math.floor(random() * 125) * DAY_MS;
    idea.createdAt = new Date(Math.min(at, AS_OF.getTime())).toISOString();
  }
}

/** Strength and haze for every fixture idea, worked out as the page does. */
function lit(ideas: IdeaOnMap[]): IdeaOnMap[] {
  const light = lightOn(ideas, AS_OF);
  return ideas.map((idea) => ({ ...idea, ...light.get(idea.id)! }));
}

/** A place for each field with four ideas or more, at the middle of its ideas. */
const PLACE_NAMES: Record<string, string> = {
  'f-econ': 'Incentives, prices and the long run',
  'f-business': 'Recurring revenue and what it is worth',
  'f-psych': 'How memory holds on',
  'f-history': 'Empires and the trade that fed them',
};

function placesFor(ideas: IdeaOnMap[]): { places: PlaceOnMap[]; placeOf: Map<string, string> } {
  const places: PlaceOnMap[] = [];
  const placeOf = new Map<string, string>();
  for (const field of FIELDS) {
    const members = ideas.filter((idea) => idea.field?.id === field.id);
    if (members.length < 4) continue;
    const id = `place-${field.id}`;
    for (const idea of members) placeOf.set(idea.id, id);
    const size = members.length;
    const mean = (pick: (idea: IdeaOnMap) => Point): Point => ({
      x: members.reduce((sum, idea) => sum + pick(idea).x, 0) / size,
      y: members.reduce((sum, idea) => sum + pick(idea).y, 0) / size,
    });
    places.push({
      id,
      name: PLACE_NAMES[field.id] ?? `${field.name} and what sits near it`,
      ideaCount: members.length,
      pca: mean((idea) => idea.pca),
      neighbourMap: mean((idea) => idea.neighbourMap),
    });
  }
  return { places, placeOf };
}

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
      const state = STATES[Math.floor(random() * STATES.length)]!;
      ideas.push({
        id,
        name,
        claim: `${name}: the claim as Learn wrote it, one or two sentences long, which the rail shows under the name so the idea can be read without opening it.`,
        state,
        stateRow: stateRowFor(state, random),
        strength: 0,
        haze: 0,
        placeId: null,
      createdAt: null,
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
      stateRow: null,
      strength: 0,
      haze: 0,
      placeId: null,
      createdAt: null,
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

  withCreated(ideas, 1997_8);
  const { places, placeOf } = placesFor(ideas);
  const shown = lit(ideas).map((idea) => ({ ...idea, placeId: placeOf.get(idea.id) ?? null }));

  return {
    ideas: shown,
    asOf: AS_OF.toISOString(),
    places,
    dust: dustFor(shown, 420, random),
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

/** Vault notes as dust, each beside a fixture idea. */
function dustFor(ideas: readonly IdeaOnMap[], count: number, random: () => number): IdeaMapView['dust'] {
  return Array.from({ length: count }, (_, i) => ({
    noteId: `note-${i}`,
    conceptId: ideas[Math.floor(random() * ideas.length)]!.id,
    similarity: 0.3 + random() * 0.5,
  }));
}

const VIEW = fixture();
const OPEN = VIEW.ideas.find((idea) => idea.name === 'Price elasticity of demand')!.id;

/** The neighbour map with its places named, one idea open with its nearest six. */
export function IdeaSpaceSurface() {
  return <IdeaSpaceView view={VIEW} params={{ ...DEFAULT_PARAMS, idea: OPEN }} />;
}

/**
 * The map as it is live until the daily run names its places: the domains
 * named instead, drawn on the axes layout, with one domain picked out in the
 * legend.
 */
export function IdeaSpaceDomainsSurface() {
  const view: IdeaMapView = { ...VIEW, places: [], missing: 0 };
  return <IdeaSpaceView view={view} params={{ ...DEFAULT_PARAMS, layout: 'axes', domain: 'life' }} />;
}

/** The card a pointer shows over a star, held open over a known idea that is fading. */
export function IdeaSpaceCardSurface() {
  const known = VIEW.ideas
    .filter((idea) => idea.stateRow?.established === 'tested' && idea.strength > 0.2)
    .sort((a, b) => a.name.localeCompare(b.name))[0]!;
  return <IdeaSpaceView view={VIEW} params={DEFAULT_PARAMS} pointingAt={known.id} />;
}

/**
 * Ten thousand test ideas in sixty clusters, for the frame rate: the map has
 * to stay smooth at this size (plan #1997.6). Neighbours are the next ideas
 * in the same cluster, which is enough for the haze.
 */
function dense(count: number): IdeaMapView {
  const random = seeded(1997);
  const clusters = Array.from({ length: 60 }, () => ({
    x: (random() - 0.5) * 1.9,
    y: (random() - 0.5) * 1.9,
    spread: 0.04 + random() * 0.1,
    domain: Object.keys(DOMAINS)[Math.floor(random() * 10)]!,
  }));
  const ideas: IdeaOnMap[] = [];
  for (let i = 0; i < count; i++) {
    const c = i % clusters.length;
    const cluster = clusters[c]!;
    const angle = random() * Math.PI * 2;
    const r = cluster.spread * Math.sqrt(random());
    const at = { x: cluster.x + Math.cos(angle) * r, y: cluster.y + Math.sin(angle) * r };
    const state = STATES[Math.floor(random() * STATES.length)]!;
    ideas.push({
      id: `dense-${i}`,
      name: `Test idea ${i + 1}`,
      claim: `Test idea ${i + 1}, for the frame rate.`,
      state,
      stateRow: stateRowFor(state, random),
      strength: 0,
      haze: 0,
      placeId: null,
      createdAt: null,
      pca: at,
      neighbourMap: at,
      neighbours: [1, 2, 3, 4, 5, 6].map((step) => ({
        id: `dense-${(i + step * clusters.length) % count}`,
        similarity: 0.6 + random() * 0.3,
      })),
      track: null,
      field: null,
      domain: { id: cluster.domain, name: DOMAINS[cluster.domain]! },
    });
  }
  withCreated(ideas, 1997_8);
  const shown = lit(ideas);
  return {
    ...VIEW,
    ideas: shown,
    places: clusters.slice(0, 30).map((cluster, i) => ({
      id: `dense-place-${i}`,
      name: `Test place ${i + 1}`,
      ideaCount: Math.floor(count / 60),
      pca: cluster,
      neighbourMap: cluster,
    })),
    dust: dustFor(shown, 3000, random),
    similarPairs: [],
    untestedNearKnown: [],
    areas: { fields: [], domains: [], fieldsMissing: 0 },
    missing: 0,
  };
}

/**
 * One place opened as a graph (plan #1997.7): every idea in it named in
 * full, its links drawn, the ideas next door round the edge, and one idea
 * pointed at so all its links show with their scores.
 */
export function IdeaSpacePlaceSurface() {
  const place = VIEW.places.find((p) => p.name === 'How memory holds on')!;
  const pointed = VIEW.ideas.find((idea) => idea.name === 'Retrieval practice beats rereading')!.id;
  return (
    <IdeaSpaceView view={VIEW} params={{ ...DEFAULT_PARAMS, place: place.id }} pointingAt={pointed} />
  );
}

/**
 * The timeline (plan #1997.8) moved back seven weeks: the ideas written since
 * are not on the map yet, and the ones lit then shine as they did that day.
 */
export function IdeaSpaceReplaySurface() {
  return <IdeaSpaceView view={VIEW} params={DEFAULT_PARAMS} daysAgo={50} />;
}

/** An idea in no place opened as its neighbourhood: itself and its six nearest. */
export function IdeaSpaceAroundSurface() {
  const loose = VIEW.ideas.find((idea) => idea.name === 'Write the summary before the detail')!.id;
  return <IdeaSpaceView view={VIEW} params={{ ...DEFAULT_PARAMS, around: loose }} />;
}

export function IdeaSpaceDenseSurface() {
  const view = useMemo(() => dense(10_000), []);
  return <IdeaSpaceView view={view} params={DEFAULT_PARAMS} />;
}

/**
 * Recording mode on (plan #1997.9) with a place open as a graph: the place and
 * the next one over are hidden, so the title, the ideas and the rail read
 * "A private place" and "Private idea", and the places left show as they are.
 */
export function IdeaSpaceRecordingSurface() {
  const hidden = VIEW.places.filter((p) => p.name === 'How memory holds on' || p.name === 'Incentives, prices and the long run');
  const open = VIEW.places.find((p) => p.name === 'How memory holds on')!;
  return (
    <IdeaSpaceView
      view={VIEW}
      params={{ ...DEFAULT_PARAMS, place: open.id }}
      recording={{ on: true, hidden: hidden.map((p) => p.id) }}
    />
  );
}

/** Recording mode off with two places ticked to hide, in the rail's Recording mode card. */
export function IdeaSpaceRecordingChooseSurface() {
  const hidden = VIEW.places.filter((p) => p.name === 'How memory holds on' || p.name === 'Incentives, prices and the long run');
  return (
    <IdeaSpaceView view={VIEW} params={DEFAULT_PARAMS} recording={{ on: false, hidden: hidden.map((p) => p.id) }} chooseOpen />
  );
}

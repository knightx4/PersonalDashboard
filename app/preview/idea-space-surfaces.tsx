'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { IdeaSpaceView } from '@/app/learn/space/idea-space-view';
import type { KnowledgeState, StateBasis } from '@/lib/learn/graph/model';
import type { IdeaMapView, IdeaOnMap, PlaceOnMap } from '@/lib/learn/map/load';
import type { GoalOnMap } from '@/lib/learn/map/goals';
import type { Point } from '@/lib/learn/map/layout';
import { lightOn } from '@/lib/learn/map/sky';
import { stateSetAt, type StrengthInput } from '@/lib/learn/strength';
import { DEFAULT_PARAMS } from '@/lib/learn/map/view';
import type { EvidenceLink } from '@/lib/learn/evidence/model';
import { kindAndCeiling } from '@/lib/learn/evidence/kinds';
import { NEXT_TOPICS_FIXTURE, topicsFor } from './idea-space-topics';
import {
  TERRITORY_GOAL,
  TERRITORY_OPEN,
  TERRITORY_POINTED,
  territoryFixture,
  territoryGoal,
  territoryLevels,
  territoryStars,
} from './idea-space-territory';
import { goalsFor } from './idea-space-goals';

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
      'Diminishing marginal utility',
      'Sunk costs',
      'Moral hazard',
      'Adverse selection',
      'The Phillips curve',
      'Neutrality of money',
      'Inflation targeting',
      'Deadweight loss',
      'Tax incidence',
      'Public goods',
      'Tragedy of the commons',
      'Network effects',
      'Switching costs',
      'Price discrimination',
      'Monopsony power in labour markets',
      'Rent seeking',
      'Diminishing returns',
      'Economies of scale',
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
      'Net revenue retention',
      'CAC payback period',
      'Lifetime value to CAC ratio',
      'Software gross margin',
      'Monthly churn',
      'The rule of 40',
      'Burn multiple',
      'Cohort analysis of retention',
      'Contribution margin per unit',
      'Working capital',
      'The three-statement model',
      'Discounted cash flow valuation',
      'Terminal value in a DCF',
      'Sensitivity tables in a model',
      'Circular references in a model',
      'INDEX and MATCH lookups',
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
      'Anchoring',
      'The availability heuristic',
      'The spacing effect',
      'Retrieval practice',
      'Desirable difficulties',
      'Confirmation bias',
      'The fundamental attribution error',
      'Hyperbolic discounting',
      'Habit loops',
      'Learned helplessness',
      'The Big Five personality traits',
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
      'Principal-agent problems',
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
      'The Marshall Plan',
      'The Great Depression',
      'Stagflation in the 1970s',
      'The fall of the Berlin Wall',
      'Decolonisation after 1945',
      'The Industrial Revolution',
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
      'Big O notation',
      'Hash tables',
      'Embeddings',
      'Cosine similarity',
      'Principal component analysis',
      'Gradient descent',
      'Overfitting',
      'Database indexes',
      'Idempotent requests',
    ],
  },
  {
    id: 'f-biology',
    name: 'Biology',
    domain: 'life',
    at: { x: 0.65, y: -0.2 },
    axes: { x: 0.35, y: -0.15 },
    ideas: [
      'Natural selection',
      'Gene expression',
      'Homeostasis',
      'Mitochondria and ATP',
      'Sleep and memory',
      'Evolutionary arms races',
      'Kin selection',
      'Circadian rhythms',
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
      'Utilitarianism',
      "Kant's categorical imperative",
      'The veil of ignorance',
      'The Stoic dichotomy of control',
      'Falsifiability',
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
    ideas: ['Entropy', 'Conservation of energy'],
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

/**
 * The subject each field's topics were prepared under (plan #2317.2), which is
 * the place they are in. Business and management holds two: the SaaS
 * territory of idea-space-territory.ts, and financial modelling.
 */
const SUBJECT_NAMES: Record<string, string> = {
  'f-econ': 'Economics for strategy work',
  'f-business': 'Financial modelling and valuation',
  'f-psych': 'How memory holds on',
  'f-history': 'Empires and the trade that fed them',
};

/** The four big fields are a subject each; the rest were prepared together as one. */
const subjectOf = (field: FieldSeed) =>
  SUBJECT_NAMES[field.id]
    ? { id: `place-${field.id}`, name: SUBJECT_NAMES[field.id]! }
    : { id: 'place-wider', name: 'Wider reading across the sciences' };

/** Each subject's place, at the middle of its topics. */
function placesFor(ideas: IdeaOnMap[]): PlaceOnMap[] {
  const members = new Map<string, IdeaOnMap[]>();
  for (const idea of ideas) {
    if (idea.placeId) members.set(idea.placeId, [...(members.get(idea.placeId) ?? []), idea]);
  }
  return [...members.entries()]
    .map(([id, list]) => {
      const size = list.length;
      const mean = (pick: (idea: IdeaOnMap) => Point): Point => ({
        x: list.reduce((sum, idea) => sum + pick(idea).x, 0) / size,
        y: list.reduce((sum, idea) => sum + pick(idea).y, 0) / size,
      });
      return {
        id,
        name: list[0]!.track?.name ?? id,
        ideaCount: list.length,
        pca: mean((idea) => idea.pca),
        neighbourMap: mean((idea) => idea.neighbourMap),
      };
    })
    .sort((a, b) => b.ideaCount - a.ideaCount || a.name.localeCompare(b.name));
}

/** Goals the subjects other than SaaS are read by, so the subjects card names some and leaves others with none. */
const SUBJECT_GOALS: Record<string, string[]> = {
  'place-f-econ': ['Lead the pricing review for the product team'],
  'place-f-business': ['Pass the CFA Level 1 exam'],
};

/** Every subject but the SaaS one as the subjects card lists it: its topics, each with a target of four. */
function subjectGoals(ideas: readonly IdeaOnMap[], places: readonly PlaceOnMap[]): GoalOnMap[] {
  return places
    .filter((place) => place.id !== TERRITORY_GOAL)
    .map((place) => {
      const own = ideas.filter((idea) => idea.placeId === place.id);
      const held = own.reduce((n, idea) => n + Math.min(idea.levels?.held ?? 0, 4), 0);
      return {
        id: place.id,
        name: place.name,
        goalNames: SUBJECT_GOALS[place.id] ?? [],
        line: `${own.length} topics · ${held} of ${own.length * 4} levels held`,
        held,
        total: own.length * 4,
        next: null,
        stars: own.map((idea) => ({
          topicId: idea.id,
          name: idea.name,
          targetLevel: 4,
          level: idea.levels?.held ?? 0,
          pca: idea.pca,
          neighbourMap: idea.neighbourMap,
        })),
        links: [],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A topic is never held wrongly or shakily: its ladder reads recognised and up (lib/learn/map/topic-stars.ts). */
function topicState(state: KnowledgeState): KnowledgeState {
  return state === 'shaky' ? 'recognised' : state === 'misconception' ? 'unknown' : state;
}

/** A fixture topic's ladder, out of eight, from its state and how it is held. */
function levelsFor(row: StrengthInput | null): NonNullable<IdeaOnMap['levels']> {
  const held = row ? ({ recognised: 2, known: 5, sharp: 7 } as Record<string, number>)[row.state] ?? 0 : 0;
  return { held, tested: row?.established === 'tested' ? held : 0, ceiling: 8 };
}

/** The ideas listed under the open fixture topic; the territory's topics carry their own. */
const IDEAS_UNDER: Record<string, string[]> = {
  'Price elasticity of demand': [
    'A price rise loses fewer buyers when there is no close substitute',
    'Elasticity is higher over a longer time',
    'Total revenue rises with price while demand is inelastic',
    'Luxury goods are more elastic than necessities',
  ],
};

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
      const state = topicState(STATES[Math.floor(random() * STATES.length)]!);
      const stateRow = stateRowFor(state, random);
      const subject = subjectOf(field);
      ideas.push({
        id,
        name,
        claim: `${name}: what the topic covers, as the preparation scoped it, one or two sentences long, which the rail shows under the name.`,
        state,
        stateRow,
        strength: 0,
        haze: 0,
        exposure: 0,
        placeId: subject.id,
        createdAt: null,
        evidence: [],
        pca: { x: clamp(1.3 * (field.axes.x + jitter(0.28))), y: clamp(1.3 * (field.axes.y + jitter(0.28))) },
        neighbourMap: { x: clamp(field.at.x + jitter(0.24)), y: clamp(field.at.y + jitter(0.24)) },
        neighbours: [],
        track: subject,
        field: { id: field.id, name: field.name },
        domain: { id: field.domain, name: DOMAINS[field.domain]! },
        levels: levelsFor(stateRow),
        ideasUnder: (IDEAS_UNDER[name] ?? []).map((idea, i) => ({ id: `${id}-idea-${i}`, name: idea })),
      });
    }
  }
  // Two topics of a subject with no field or domain yet.
  for (const name of ['Writing the summary first', 'Checklists under stress']) {
    n += 1;
    ideas.push({
      id: `idea-${String(n).padStart(3, '0')}`,
      name,
      claim: `${name}, as the preparation scoped it.`,
      state: 'unknown',
      stateRow: null,
      strength: 0,
      haze: 0,
      exposure: 0,
      placeId: 'place-working',
      createdAt: null,
      evidence: [],
      pca: { x: jitter(0.6), y: jitter(0.6) },
      neighbourMap: { x: 0.45 + jitter(0.1), y: -0.85 + jitter(0.1) },
      neighbours: [],
      track: { id: 'place-working', name: 'Working well under pressure' },
      field: null,
      domain: null,
      levels: { held: 0, tested: 0, ceiling: 6 },
    });
  }
  // The SaaS subject's territory, its topics among the business ones.
  ideas.push(...territoryStars());

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
  const places = placesFor(ideas);
  const shown = lit(ideas);

  return {
    ideas: shown,
    asOf: AS_OF.toISOString(),
    places,
    // The vault's dust sat beside ideas; a topic has none (plan #2317.2).
    dust: [],
    territories: [territoryFixture()],
    goals: [territoryGoal(), ...subjectGoals(shown, places)],
    variance: { first: 0.087, second: 0.054 },
    projection: {
      mean: [],
      components: [[], []],
      variance: [0.087, 0.054],
      frame: { cx: 0, cy: 0, scale: 1 },
    },
    similarPairs: [],
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
    topics: topicsFor(shown, fields, AS_OF.toISOString()),
    missing: 3,
  };
}


const EVIDENCE_BASES: { sourceKind: EvidenceLink['sourceKind']; basis: string; weight: number; similarity: number }[] = [
  { sourceKind: 'course', basis: 'from MGT 541 Corporate Finance, HH, 2026', weight: 0.95, similarity: 0.71 },
  {
    sourceKind: 'note',
    basis: 'you wrote about this in Corporate Finance week 6: WACC, the cost of capital and why the terminal year carries the valuation',
    weight: 1,
    similarity: 0.68,
  },
  {
    sourceKind: 'work',
    basis: 'From your résumé: "Built the three-statement model for a 40 million dollar carve-out and took the client CFO through its sensitivities"',
    weight: 1,
    similarity: 0.63,
  },
  {
    sourceKind: 'work',
    basis: 'From your application notes in Stripe Strategy & Operations: "The team wants someone who has valued a business"',
    weight: 0.4,
    similarity: 0.62,
  },
  { sourceKind: 'note', basis: 'you wrote about this in Pricing power, clipped', weight: 0.25, similarity: 0.61 },
];

const EVIDENCE_OPEN_NAME = 'Terminal value in a DCF';

function linksFor(ideaId: string, from: number, count: number): EvidenceLink[] {
  return Array.from({ length: count }, (_, i) => {
    const base = EVIDENCE_BASES[(from + i) % EVIDENCE_BASES.length]!;
    return {
      id: `${ideaId}-ev-${i}`,
      targetKind: 'idea' as const,
      targetId: ideaId,
      sourceKind: base.sourceKind,
      sourceId: `src-${(from + i) % EVIDENCE_BASES.length}`,
      similarity: base.similarity,
      ...kindAndCeiling({ source_kind: base.sourceKind, weight: base.weight }),
      basis: base.basis,
      foundAt: AS_OF.toISOString(),
    };
  }).sort((a, b) => b.ceiling - a.ceiling || b.similarity - a.similarity);
}

const VIEW = fixture();
const OPEN = VIEW.ideas.find((idea) => idea.name === 'Price elasticity of demand')!.id;

/** The neighbour map with its places named, one idea open with its nearest six. */
export function IdeaSpaceSurface() {
  // The open idea was tested, and a note and a piece of work touch it too.
  const view = {
    ...VIEW,
    ideas: VIEW.ideas.map((idea) => (idea.id === OPEN ? { ...idea, evidence: linksFor(idea.id, 1, 2) } : idea)),
  };
  return <IdeaSpaceView view={view} params={{ ...DEFAULT_PARAMS, idea: OPEN }} nextTopics={NEXT_TOPICS_FIXTURE} />;
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
      name: `Test topic ${i + 1}`,
      claim: `Test topic ${i + 1}, for the frame rate.`,
      state,
      stateRow: stateRowFor(state, random),
      strength: 0,
      haze: 0,
      exposure: 0,
      placeId: null,
      createdAt: null,
      evidence: [],
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
      name: `Test subject ${i + 1}`,
      ideaCount: Math.floor(count / 60),
      pca: cluster,
      neighbourMap: cluster,
    })),
    dust: [],
    similarPairs: [],
    untestedNearKnown: [],
    // Its test subjects have no targets, so the subjects card and the territories are empty.
    goals: [],
    territories: [],
    areas: { fields: [], domains: [], fieldsMissing: 0 },
    missing: 0,
  };
}

/**
 * A subject's name pressed on the sky (plan #2317.2): its place is its
 * territory, which opens on the first topic you are ready for.
 */
export function IdeaSpacePlaceSurface() {
  return <IdeaSpaceView view={VIEW} params={{ ...DEFAULT_PARAMS, place: TERRITORY_GOAL }} />;
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
  const loose = VIEW.ideas.find((idea) => idea.name === 'Writing the summary first')!.id;
  return <IdeaSpaceView view={VIEW} params={{ ...DEFAULT_PARAMS, around: loose }} />;
}

/**
 * A goal's territory opened on one of its topics (plan #2187.3): the topics as
 * stars with their arcs and target rings, requirement links with arrowheads,
 * and the ideas next door round the edge.
 */
// The open topic was met in a note and a piece of work, which its popup lists (plan #2317.2).
const TERRITORY_VIEW = {
  ...VIEW,
  ideas: VIEW.ideas.map((idea) =>
    idea.id === TERRITORY_OPEN || idea.id === TERRITORY_POINTED ? { ...idea, evidence: linksFor(idea.id, 1, 2) } : idea,
  ),
};
const TERRITORY_PARAMS = { ...DEFAULT_PARAMS, goal: TERRITORY_GOAL, topic: TERRITORY_OPEN };

export function IdeaSpaceTerritorySurface() {
  return <IdeaSpaceView view={TERRITORY_VIEW} params={TERRITORY_PARAMS} />;
}

/**
 * A territory as thin as the live one (plan #2187.7): topics with nothing
 * held yet, one requirement between them, and nothing ready, so no route.
 */
const THIN = territoryFixture();
const THIN_VIEW = {
  ...VIEW,
  // Its topics on the sky are as dark as their ladders.
  ideas: VIEW.ideas.map((idea) =>
    idea.placeId === TERRITORY_GOAL
      ? { ...idea, state: 'unknown' as const, stateRow: null, strength: 0, levels: { ...idea.levels!, tested: 0, held: 0 } }
      : idea,
  ),
  territories: [
    {
      ...THIN,
      topics: THIN.topics.map((topic) => ({ ...topic, tested: 0, held: 0, missed: [] })),
      links: THIN.links.slice(0, 1),
      ready: [],
      standing: [],
    },
  ],
};

export function IdeaSpaceTerritoryThinSurface() {
  return <IdeaSpaceView view={THIN_VIEW} params={TERRITORY_PARAMS} />;
}

/** The same territory with its most linked star pointed at: every link it has, the level each needs, and its level line. */
export function IdeaSpaceTerritoryHoverSurface() {
  return (
    <IdeaSpaceView
      view={TERRITORY_VIEW}
      params={{ ...TERRITORY_PARAMS, topic: TERRITORY_POINTED }}
      pointingAt={TERRITORY_POINTED}
    />
  );
}

/**
 * The open topic's words (plan #2187.5): the quote of the answer that showed
 * the level, folded in the rail until tapped, drawn open here.
 */
export function IdeaSpaceTerritoryQuoteSurface() {
  return <IdeaSpaceView view={TERRITORY_VIEW} params={TERRITORY_PARAMS} holdQuote />;
}

/**
 * The panels under the map (plan #2187.6), on the territory opened: what
 * will fade, the gaps to a target and then and now, each its own tab.
 */
const PANELS_VIEW = { ...TERRITORY_VIEW, levels: territoryLevels(VIEW.asOf) };
/** As thin as the live subject: drafts with nothing held, one link, and none of its topics lit. */
const THIN_PANELS_VIEW = {
  ...THIN_VIEW,
  levels: territoryLevels(VIEW.asOf, { thin: true }),
};

export function IdeaSpaceFadeSurface() {
  return <IdeaSpaceView view={PANELS_VIEW} params={{ ...TERRITORY_PARAMS, panel: 'fade' }} />;
}

export function IdeaSpaceFadeEmptySurface() {
  return <IdeaSpaceView view={THIN_PANELS_VIEW} params={{ ...TERRITORY_PARAMS, panel: 'fade' }} />;
}

export function IdeaSpaceGapsSurface() {
  return <IdeaSpaceView view={PANELS_VIEW} params={{ ...TERRITORY_PARAMS, panel: 'gaps' }} />;
}

export function IdeaSpaceGapsThinSurface() {
  return <IdeaSpaceView view={THIN_PANELS_VIEW} params={{ ...TERRITORY_PARAMS, panel: 'gaps' }} />;
}

/** No goal chosen: the gaps tab says to choose one. */
export function IdeaSpaceGapsEmptySurface() {
  return <IdeaSpaceView view={PANELS_VIEW} params={{ ...DEFAULT_PARAMS, panel: 'gaps' }} />;
}

export function IdeaSpaceThenSurface() {
  return <IdeaSpaceView view={PANELS_VIEW} params={{ ...TERRITORY_PARAMS, panel: 'then' }} />;
}

export function IdeaSpaceThenPickSurface() {
  return <IdeaSpaceView view={PANELS_VIEW} params={{ ...TERRITORY_PARAMS, panel: 'then' }} pickThen />;
}

export function IdeaSpaceThenThinSurface() {
  return <IdeaSpaceView view={THIN_PANELS_VIEW} params={{ ...TERRITORY_PARAMS, panel: 'then' }} />;
}

export function IdeaSpaceDenseSurface() {
  const view = useMemo(() => dense(10_000), []);
  return <IdeaSpaceView view={view} params={DEFAULT_PARAMS} />;
}

/** The two subjects the recording shots hide: the SaaS territory and economics. */
const HIDDEN = [TERRITORY_GOAL, 'place-f-econ'];

/**
 * Recording mode on (plan #1997.9) with a subject's territory open: it and
 * one other subject are hidden, so the title, its topics, the subjects card
 * and the rail read "A private subject" and "Private topic", and the
 * subjects left show as they are.
 */
export function IdeaSpaceRecordingSurface() {
  return (
    <IdeaSpaceView view={VIEW} params={{ ...DEFAULT_PARAMS, place: TERRITORY_GOAL }} recording={{ on: true, hidden: HIDDEN }} />
  );
}

/** Recording mode off with two subjects ticked to hide, in the rail's Recording mode card. */
export function IdeaSpaceRecordingChooseSurface() {
  return <IdeaSpaceView view={VIEW} params={DEFAULT_PARAMS} recording={{ on: false, hidden: HIDDEN }} chooseOpen />;
}

/**
 * An idea lights up (plan #1997.10): three ideas set in the last two days, one
 * tested a few hours ago, one said to be known yesterday morning, one tested
 * the day before, and the rest of the map as it stands. The view is mounted
 * afresh on each press, so the recorder sees the stars brighten from dark.
 */
const LIT_FIXTURE = (() => {
  const set: [string, StateBasis, number][] = [
    ['Opportunity cost', 'tested', 3],
    ['The spacing effect', 'declared', 30],
    ['Annual recurring revenue', 'tested', 40],
  ];
  const rows = new Map(
    set.map(([name, established, hours]) => {
      const at = new Date(AS_OF.getTime() - hours * 3_600_000).toISOString();
      const row: StrengthInput = {
        state: 'known',
        established,
        tested_at: established === 'tested' ? at : null,
        declared_at: established === 'declared' ? at : null,
        review_interval_days: null,
      };
      return [VIEW.ideas.find((idea) => idea.name === name)!.id, row] as const;
    }),
  );
  const ideas = VIEW.ideas.map((idea) => {
    const row = rows.get(idea.id);
    return row ? { ...idea, state: row.state, stateRow: row } : idea;
  });
  return { ...VIEW, ideas: lit(ideas.map((idea) => ({ ...idea, createdAt: idea.createdAt }))).map((idea, i) => ({ ...idea, placeId: VIEW.ideas[i]!.placeId })) };
})();

export function IdeaSpaceLightsSurface() {
  const [visit, setVisit] = useState(0);
  return (
    <div className="space-y-4">
      <Button variant="secondary" size="sm" data-motion-demo="lights-up" onClick={() => setVisit((n) => n + 1)}>
        Open the map again
      </Button>
      <IdeaSpaceView key={visit} view={LIT_FIXTURE} params={DEFAULT_PARAMS} />
    </div>
  );
}

/**
 * Evidence lighting the map (plan #2006.6): about a third of the ideas not
 * known yet are backed by a note, a course or your work, so they glow up to
 * the ceiling a recognised idea held as inferred would have. One of them, a
 * DCF idea no question has been asked about, is open in the rail with its
 * three strongest links and pointed at, so its card says what backs it.
 */
const EVIDENCE_FIXTURE: IdeaMapView = (() => {
  let unknown = 0;
  const ideas = VIEW.ideas.map((idea) => {
    if (idea.name === EVIDENCE_OPEN_NAME) {
      return {
        ...idea,
        // Held at level 3 by inference from another topic, never asked about itself.
        state: 'recognised' as const,
        stateRow: {
          state: 'recognised' as const,
          established: 'inferred' as const,
          tested_at: null,
          declared_at: new Date(AS_OF.getTime() - 12 * DAY_MS).toISOString(),
          review_interval_days: null,
        },
        levels: { ...idea.levels!, held: 3, tested: 0 },
        evidence: linksFor(idea.id, 0, 5),
        ideasUnder: [
          { id: 'tv-idea-1', name: 'Terminal value is often most of a DCF’s total' },
          { id: 'tv-idea-2', name: 'A perpetuity growth rate above GDP growth is a warning sign' },
        ],
      };
    }
    if (idea.state !== 'unknown') return idea;
    unknown += 1;
    // Every third idea not known yet: some by a clipping alone, some by your own writing.
    if (unknown % 3 !== 0) return idea;
    return { ...idea, evidence: linksFor(idea.id, unknown % EVIDENCE_BASES.length, 1 + (unknown % 2)) };
  });
  return {
    ...VIEW,
    ideas: lit(ideas).map((idea, i) => ({ ...idea, placeId: VIEW.ideas[i]!.placeId })),
  };
})();

export function IdeaSpaceEvidenceSurface() {
  const open = EVIDENCE_FIXTURE.ideas.find((idea) => idea.name === EVIDENCE_OPEN_NAME)!.id;
  return <IdeaSpaceView view={EVIDENCE_FIXTURE} params={{ ...DEFAULT_PARAMS, idea: open }} pointingAt={open} holdMore />;
}

/**
 * The map flown into one Level 3 topic (plan #2016.5): Economics, with
 * twenty-two Level 4 topics unlocked inside it, seven of them named,
 * strongest first, and the rest folded into a count under its name.
 */
export function IdeaSpaceTopicsSurface() {
  return <IdeaSpaceView view={VIEW} params={DEFAULT_PARAMS} zoomOn="t3-f-econ-0" nextTopics={NEXT_TOPICS_FIXTURE} />;
}

/**
 * The sky of ten thousand ideas with the three goals of idea-space-goals.tsx
 * (plan #2187.2), their topics in one region of it, as a goal's topics are
 * about neighbouring things: ideas round one cluster, kept apart so each
 * ring reads.
 */
function denseWithGoals(): IdeaMapView {
  const sky = dense(10_000);
  const middle = sky.ideas[7]!.neighbourMap;
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const near: IdeaOnMap[] = [];
  for (const idea of [...sky.ideas].sort((a, b) => distance(a.neighbourMap, middle) - distance(b.neighbourMap, middle))) {
    if (near.length >= 18) break;
    if (near.every((other) => distance(other.neighbourMap, idea.neighbourMap) > 0.09)) near.push(idea);
  }
  return { ...sky, goals: goalsFor(near) };
}

/**
 * A goal chosen on the sky of ten thousand ideas (plan #2187.2): its twelve
 * topics ringed at their targets, joined where one needs another, and named,
 * with the goals in the rail and the chosen one's next rung under it.
 */
export function IdeaSpaceGoalSurface() {
  const view = useMemo(() => denseWithGoals(), []);
  return <IdeaSpaceView view={view} params={{ ...DEFAULT_PARAMS, goal: 'goal-saas' }} />;
}

/**
 * The same sky and rail with no goal chosen, so no ring or line is drawn,
 * and one row's next rung held open as a pointer over it would.
 */
export function IdeaSpaceGoalNextSurface() {
  const view = useMemo(() => denseWithGoals(), []);
  return <IdeaSpaceView view={view} params={DEFAULT_PARAMS} holdNext="goal-accounts" />;
}

/**
 * The layer switch (plan #2187.5) with courses and work turned off: the idea
 * no question has been asked about loses the ring those gave it, the ones
 * your notes back keep theirs, and its list says only what is on.
 */
export function IdeaSpaceLayersSurface() {
  const open = EVIDENCE_FIXTURE.ideas.find((idea) => idea.name === EVIDENCE_OPEN_NAME)!.id;
  return (
    <IdeaSpaceView
      view={EVIDENCE_FIXTURE}
      params={{ ...DEFAULT_PARAMS, idea: open }}
      layersOn={{ answers: true, courses: false, writing: true }}
    />
  );
}

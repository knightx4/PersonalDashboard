/**
 * How deep a Learn now pick is pitched, from what the person has swiped
 * (LEARN-NOW-SPEC, "Cards after the first week").
 *
 * Every pick starts past the basics. The owner already knows the definition
 * of supply and demand, and a card that restates it teaches nothing, so the
 * lowest level is 'working': mechanisms, applications and cases, never an
 * overview. Each card on a theme or field swiped down ("I'm good on this")
 * counts towards the next level, and the naming call is told which articles
 * those were so it goes past them.
 *
 * Cards swiped right ("I need to work on this") are passed the other way: the
 * naming call is told to come at the same ideas from a different angle rather
 * than go deeper.
 *
 * The Too hard and Too easy ratings on a card (plan #894) move the count
 * directly: a card rated too easy adds one, and a card rated too hard takes
 * one off, never below zero. So one Too hard on an advanced theme takes it
 * back to working, and Too hard on a working theme keeps it at working, which
 * stays the floor (plan #892). A rating is read apart from the swipe, so a
 * card swiped known and rated too easy counts twice. The naming call is given
 * the titles rated too hard and told to go easier than them.
 *
 * Pure, so the rules are tested directly.
 */

import type { CardDifficulty } from './card';

export type Depth = 'working' | 'advanced' | 'specialist';

/** Known cards on one theme or field before the next level. */
export const KNOWN_FOR_ADVANCED = 2;
export const KNOWN_FOR_SPECIALIST = 5;

/** Titles passed to the naming call, at most, per list. */
const MAX_TITLES = 12;

/**
 * What the person has swiped and rated on one theme or field, as card titles,
 * newest first.
 */
export type Swiped = { known: string[]; review: string[]; tooHard: string[]; tooEasy: string[] };

const NOTHING_SWIPED: Swiped = { known: [], review: [], tooHard: [], tooEasy: [] };

export type DepthProgress = {
  themes: ReadonlyMap<string, Swiped>;
  fields: ReadonlyMap<string, Swiped>;
};

export const NO_PROGRESS: DepthProgress = { themes: new Map(), fields: new Map() };

/** What the naming and writing calls are told about one target. */
export type DepthContext = {
  depth: Depth;
  /** Cards on this target the person said they already know. */
  known: string[];
  /** Cards on this target the person said they need to work on. */
  review: string[];
  /** Cards on this target the person rated too hard. */
  tooHard: string[];
};

export function depthFor(knownCount: number): Depth {
  if (knownCount >= KNOWN_FOR_SPECIALIST) return 'specialist';
  if (knownCount >= KNOWN_FOR_ADVANCED) return 'advanced';
  return 'working';
}

/** The columns of a feed card this reads. */
export type CardSwipe = {
  status: string;
  theme_id: string | null;
  field_id: string | null;
  reason: string;
  /** "Article: Section", as the card showed it. */
  title: string | null;
  /** The Too hard or Too easy rating, read apart from `status`. */
  difficulty: CardDifficulty | null;
};

function push(map: Map<string, Swiped>, id: string, kinds: readonly (keyof Swiped)[], title: string) {
  const swiped = map.get(id) ?? { known: [], review: [], tooHard: [], tooEasy: [] };
  for (const kind of kinds) if (!swiped[kind].includes(title)) swiped[kind].push(title);
  map.set(id, swiped);
}

/** The level from one target's swipes and ratings. */
export function levelFrom(swiped: Swiped): Depth {
  return depthFor(Math.max(0, swiped.known.length + swiped.tooEasy.length - swiped.tooHard.length));
}

/**
 * The swipes and ratings per theme and per field. Cards are expected newest
 * first, and the lists keep that order. An interest card counts towards its
 * theme only, so a field with many themes in it does not jump a level from
 * swipes on one of them; a gap card counts towards its field. A card rated
 * but not swiped still counts for its rating.
 */
export function progressFrom(cards: readonly CardSwipe[]): DepthProgress {
  const themes = new Map<string, Swiped>();
  const fields = new Map<string, Swiped>();
  for (const card of cards) {
    const kinds: (keyof Swiped)[] = [];
    if (card.status === 'known') kinds.push('known');
    else if (card.status === 'review') kinds.push('review');
    if (card.difficulty === 'too_hard') kinds.push('tooHard');
    else if (card.difficulty === 'too_easy') kinds.push('tooEasy');
    if (kinds.length === 0 || !card.title) continue;
    if (card.reason === 'interest' && card.theme_id) push(themes, card.theme_id, kinds, card.title);
    else if (card.reason === 'gap' && card.field_id) push(fields, card.field_id, kinds, card.title);
  }
  return { themes, fields };
}

/** The context for one target: a theme for interest, a field for a gap. */
export function contextFor(
  progress: DepthProgress,
  target: { reason: 'interest'; themeId: string } | { reason: 'gap'; fieldId: string },
): DepthContext {
  const swiped = (target.reason === 'interest'
    ? progress.themes.get(target.themeId)
    : progress.fields.get(target.fieldId)) ?? NOTHING_SWIPED;
  return {
    depth: levelFrom(swiped),
    known: swiped.known.slice(0, MAX_TITLES),
    review: swiped.review.slice(0, MAX_TITLES),
    tooHard: swiped.tooHard.slice(0, MAX_TITLES),
  };
}

/** The level, said to the model. Exported for the test and for the writer. */
export function describeDepth(depth: Depth): string {
  switch (depth) {
    case 'working':
      return 'They already know the definitions and the textbook basics. Pitch it past the introduction: how the thing actually works, where it is applied, real cases and numbers, results that surprise people.';
    case 'advanced':
      return 'They have shown they know the standard material here. Pitch it at an advanced student: named models and their assumptions, empirical findings, where the simple account breaks down, live disagreements.';
    case 'specialist':
      return 'They know this area well. Pitch it at a specialist: particular results, methods, edge cases, history of how a finding was reached, open problems.';
  }
}

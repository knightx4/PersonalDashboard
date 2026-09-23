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
 * Pure, so the rules are tested directly.
 */

export type Depth = 'working' | 'advanced' | 'specialist';

/** Known cards on one theme or field before the next level. */
export const KNOWN_FOR_ADVANCED = 2;
export const KNOWN_FOR_SPECIALIST = 5;

/** Titles passed to the naming call, at most, per list. */
const MAX_TITLES = 12;

/** What the person has swiped on one theme or field, as card titles, newest first. */
export type Swiped = { known: string[]; review: string[] };

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
};

function push(map: Map<string, Swiped>, id: string, kind: keyof Swiped, title: string) {
  const swiped = map.get(id) ?? { known: [], review: [] };
  if (!swiped[kind].includes(title)) swiped[kind].push(title);
  map.set(id, swiped);
}

/**
 * The swipes per theme and per field. Cards are expected newest first, and
 * the lists keep that order. An interest card counts towards its theme only,
 * so a field with many themes in it does not jump a level from swipes on one
 * of them; a gap card counts towards its field.
 */
export function progressFrom(cards: readonly CardSwipe[]): DepthProgress {
  const themes = new Map<string, Swiped>();
  const fields = new Map<string, Swiped>();
  for (const card of cards) {
    const kind: keyof Swiped | null =
      card.status === 'known' ? 'known' : card.status === 'review' ? 'review' : null;
    if (!kind || !card.title) continue;
    if (card.reason === 'interest' && card.theme_id) push(themes, card.theme_id, kind, card.title);
    else if (card.reason === 'gap' && card.field_id) push(fields, card.field_id, kind, card.title);
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
    : progress.fields.get(target.fieldId)) ?? { known: [], review: [] };
  return {
    depth: depthFor(swiped.known.length),
    known: swiped.known.slice(0, MAX_TITLES),
    review: swiped.review.slice(0, MAX_TITLES),
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

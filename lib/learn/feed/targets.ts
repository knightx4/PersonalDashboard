import { shadeFor } from '@/lib/learn/areas/grid';
import type { Depth } from './depth';
import { NO_PREFERENCES, fieldWeight, goalWeight, themeWeight, type FeedPreferences } from './preference';

/**
 * Choosing what the next Learn now cards are about (LEARN-NOW-SPEC, "How cards
 * are made", step 1).
 *
 * Pure: the themes, fields and test counts go in, a list of targets comes out,
 * and the pass in `pass.ts` does the reading and writing. Three draws in four
 * take a theme you write about, weighted by its strength. The fourth takes a
 * gap field: one you write about and have never been tested in, and once those
 * run out, one with nothing in it at all. A target drawn in the last few weeks
 * is skipped, so the feed does not keep returning to one theme.
 *
 * The three-to-one split is kept by count rather than by chance: the next
 * target is a gap whenever gap cards are behind a quarter of every card picked
 * for the person, so the ratio holds across calls and a run of bad luck cannot
 * give someone twelve interest cards in a row.
 *
 * What the person saved and turned down leans each draw (plan #809): a theme's
 * strength is multiplied by `themeWeight`, and within each kind of gap a field
 * is drawn in proportion to `fieldWeight`. Both are in `preference.ts`. The
 * lean changes how often something comes up and never which kind of gap comes
 * first.
 *
 * Goals (plan #900) are a third source. One card in three is drawn for a
 * goal on the Goals page, the Level 3 goal included (plan #910), by the same
 * count-based rule, and the other two keep the three-to-one split between
 * themes and gaps. The goal
 * count starts when the oldest goal still active was set (`wantsGoal`), so
 * adding a first goal after months of cards gives it its share from then on
 * rather than a run of nothing but goal cards to catch up. Saves and
 * dismissals lean each goal as they lean a theme (`goalWeight`).
 */

/** A theme placed in a field. Themes placed at a domain, or nowhere, are not drawn. */
export type FeedTheme = {
  id: string;
  name: string;
  about: string;
  strength: number;
  fieldId: string;
};

export type FeedField = {
  id: string;
  slug: string;
  name: string;
  scope: string;
  /** The domain's name, for the prompt. */
  domain: string;
};

/** What the tracks placed in one field have shown. */
export type FieldTests = { tracks: number; answered: number };

/**
 * A goal, as the draw needs it. The Level 3 goal is drawn here like the
 * open-subject ones and shares their one card in three, but its `list` is set,
 * and the pass takes its articles from that list instead of the naming call
 * (plan #910, `level3.ts`).
 */
export type FeedGoal = {
  id: string;
  name: string;
  /** 'level3' for the Level 3 goal, whose cards come from its list. Left out for an open subject. */
  list?: 'level3';
  /** What the person means by it, when they said. */
  about: string | null;
  /** The card depth the goal starts at, from its depth (`cardDepthForAim`). */
  depth: Depth;
  /** The field it is placed in. Null when placed at a domain, spanning domains, or not placed yet. */
  field: FeedField | null;
  /** The domain's name, when it is placed at a whole domain. */
  domain: string | null;
};

export type FeedTarget =
  | { reason: 'interest'; theme: FeedTheme; field: FeedField }
  | { reason: 'goal'; goal: FeedGoal }
  | {
      reason: 'gap';
      /** Which of the two gaps: written about and never tested, or nothing at all. */
      gap: 'untested' | 'untouched';
      field: FeedField;
    };

/** How long a target is left alone after a card is picked for it. */
export const RECENT_TARGET_DAYS = 21;

/**
 * How long a goal is passed over for another goal after a card is picked for
 * it. Much shorter than for a theme, and only ever in favour of another goal:
 * a person has a handful of goals rather than dozens of themes, and a goal
 * left alone for three weeks could not have one card in three.
 */
export const RECENT_GOAL_DAYS = 3;

/** One card in this many is a gap, of the cards not drawn for a goal. */
const GAP_EVERY = 4;

/** One card in this many is drawn for a goal (decision #899). */
export const GOAL_EVERY = 3;

/**
 * Whether the next target should be a gap, given the cards picked so far.
 *
 * A gap is drawn while gap cards are fewer than a quarter of all cards. One
 * target yields two or three cards, so a rule by position ("every fourth
 * target") would drift with how many each target yields; this one corrects
 * itself.
 */
export function wantsGap(picked: { interest: number; gap: number }): boolean {
  return picked.gap * GAP_EVERY < picked.interest + picked.gap;
}

/**
 * Whether the next target should be a goal, given the cards picked since the
 * oldest goal still active was set: `goal` of them drawn for a goal, `total`
 * in all.
 *
 * The same self-correcting rule as `wantsGap`, but at or under the share
 * rather than strictly under it, so a goal set a minute ago is drawn first.
 */
export function wantsGoal(window: { goal: number; total: number }): boolean {
  return window.goal * GOAL_EVERY <= window.total;
}

/**
 * The gap fields, in the order the spec draws them.
 *
 * "Written about" uses the grid's own threshold (`shadeFor` at 2 or more), so
 * a field counts as one you write about here exactly when the Know page draws
 * it that way. A field is untested when nothing in it has been answered, even
 * if a track has been placed there. It is untouched when it has no theme and
 * no track at all.
 */
export function gapFields(
  fields: FeedField[],
  themes: FeedTheme[],
  tests: ReadonlyMap<string, FieldTests>,
): { untested: FeedField[]; untouched: FeedField[] } {
  const strength = new Map<string, number>();
  const count = new Map<string, number>();
  for (const theme of themes) {
    strength.set(theme.fieldId, (strength.get(theme.fieldId) ?? 0) + theme.strength);
    count.set(theme.fieldId, (count.get(theme.fieldId) ?? 0) + 1);
  }
  const strongest = Math.max(0, ...strength.values());

  const untested: FeedField[] = [];
  const untouched: FeedField[] = [];
  for (const field of fields) {
    const tested = tests.get(field.id) ?? { tracks: 0, answered: 0 };
    const shade = shadeFor(strength.get(field.id) ?? 0, strongest);
    if (shade >= 2 && tested.answered === 0) untested.push(field);
    else if ((count.get(field.id) ?? 0) === 0 && tested.tracks === 0) untouched.push(field);
  }
  return { untested, untouched };
}

/** One item from `pool`, with a chance proportional to its weight. */
function weightedPick<T>(pool: T[], weight: (item: T) => number, random: () => number): T | null {
  const total = pool.reduce((sum, item) => sum + weight(item), 0);
  if (total <= 0) return null;
  let at = random() * total;
  for (const item of pool) {
    at -= weight(item);
    if (at < 0) return item;
  }
  return pool[pool.length - 1] ?? null;
}

export type DrawInput = {
  themes: FeedTheme[];
  fields: FeedField[];
  tests: ReadonlyMap<string, FieldTests>;
  /** Themes and fields with a card picked in the last RECENT_TARGET_DAYS. */
  recentThemeIds: ReadonlySet<string>;
  recentFieldIds: ReadonlySet<string>;
  /** Active open-subject goals. None when left out. */
  goals?: FeedGoal[];
  /** Goals with a card picked in the last RECENT_GOAL_DAYS. */
  recentAimIds?: ReadonlySet<string>;
  /** Saves and dismissals on earlier cards. None when left out. */
  preferences?: FeedPreferences;
  random?: () => number;
};

export type Drawer = {
  /**
   * The next target, never one drawn before in this pass and never a recent
   * one. When the kind asked for has nothing left it returns the other kind,
   * so a person whose gap fields were all covered recently still gets cards.
   * Null only when every kind is exhausted.
   *
   * `wantGoal` asks for a goal first, and a goal asked for is never refused
   * while the person has one: a goal drawn recently is passed over only for
   * another goal, and once every goal has been drawn in this pass one is drawn
   * again (the naming call is told the articles already picked, so it names
   * others). Without `wantGoal`, a goal is the last resort, and only one not
   * yet drawn in this pass.
   */
  next(wantGap: boolean, wantGoal?: boolean): FeedTarget | null;
};

export function createDrawer(input: DrawInput): Drawer {
  const random = input.random ?? Math.random;
  const fieldById = new Map(input.fields.map((field) => [field.id, field]));
  const usedThemes = new Set(input.recentThemeIds);
  const usedFields = new Set(input.recentFieldIds);
  const gaps = gapFields(input.fields, input.themes, input.tests);
  const preferences = input.preferences ?? NO_PREFERENCES;
  const goals = input.goals ?? [];
  const recentAims = input.recentAimIds ?? new Set<string>();
  const usedAims = new Set<string>();

  const drawInterest = (): FeedTarget | null => {
    const pool = input.themes.filter(
      (theme) => !usedThemes.has(theme.id) && theme.strength > 0 && fieldById.has(theme.fieldId),
    );
    const theme = weightedPick(
      pool,
      (item) => item.strength * themeWeight(preferences, item.id, item.fieldId),
      random,
    );
    if (!theme) return null;
    usedThemes.add(theme.id);
    return { reason: 'interest', theme, field: fieldById.get(theme.fieldId)! };
  };

  const drawGap = (): FeedTarget | null => {
    for (const gap of ['untested', 'untouched'] as const) {
      const pool = gaps[gap].filter((field) => !usedFields.has(field.id));
      const field = weightedPick(pool, (item) => fieldWeight(preferences, item.id), random);
      if (!field) continue;
      usedFields.add(field.id);
      return { reason: 'gap', gap, field };
    }
    return null;
  };

  const drawGoal = (asked: boolean): FeedTarget | null => {
    const unused = goals.filter((goal) => !usedAims.has(goal.id));
    const fresh = unused.filter((goal) => !recentAims.has(goal.id));
    const pool = fresh.length > 0 ? fresh : unused.length > 0 || !asked ? unused : goals;
    const goal = weightedPick(pool, (item) => goalWeight(preferences, item.id), random);
    if (!goal) return null;
    usedAims.add(goal.id);
    return { reason: 'goal', goal };
  };

  return {
    next: (wantGap, wantGoal = false) => {
      const other = () => (wantGap ? (drawGap() ?? drawInterest()) : (drawInterest() ?? drawGap()));
      if (wantGoal) return drawGoal(true) ?? other();
      return other() ?? drawGoal(false);
    },
  };
}

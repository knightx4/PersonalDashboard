import { shadeFor } from '@/lib/learn/areas/grid';
import { NO_PREFERENCES, fieldWeight, themeWeight, type FeedPreferences } from './preference';

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

export type FeedTarget =
  | { reason: 'interest'; theme: FeedTheme; field: FeedField }
  | {
      reason: 'gap';
      /** Which of the two gaps: written about and never tested, or nothing at all. */
      gap: 'untested' | 'untouched';
      field: FeedField;
    };

/** How long a target is left alone after a card is picked for it. */
export const RECENT_TARGET_DAYS = 21;

/** One card in this many is a gap. */
const GAP_EVERY = 4;

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
  /** Saves and dismissals on earlier cards. None when left out. */
  preferences?: FeedPreferences;
  random?: () => number;
};

export type Drawer = {
  /**
   * The next target, never one drawn before in this pass and never a recent
   * one. When the kind asked for has nothing left it returns the other kind,
   * so a person whose gap fields were all covered recently still gets cards.
   * Null only when both are exhausted.
   */
  next(wantGap: boolean): FeedTarget | null;
};

export function createDrawer(input: DrawInput): Drawer {
  const random = input.random ?? Math.random;
  const fieldById = new Map(input.fields.map((field) => [field.id, field]));
  const usedThemes = new Set(input.recentThemeIds);
  const usedFields = new Set(input.recentFieldIds);
  const gaps = gapFields(input.fields, input.themes, input.tests);
  const preferences = input.preferences ?? NO_PREFERENCES;

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

  return {
    next: (wantGap) => (wantGap ? (drawGap() ?? drawInterest()) : (drawInterest() ?? drawGap())),
  };
}

/**
 * How much Learn now leans towards or away from a theme or field, from what
 * the person did with earlier cards (LEARN-NOW-SPEC, "What is recorded";
 * plan #809).
 *
 * Only two actions count. Not interested (a card left `dismissed`) lowers the
 * weight of the card's theme and field, and Save (a card with a
 * `saved_reading_id`, which a saved card keeps after Test me moves it to
 * `tested`) raises it. Opening the source, testing without saving, pressing
 * Next (a card left `passed`) and scrolling past a card count for nothing: a
 * pass only takes the card out of the feed.
 *
 * Each save multiplies the weight by SAVE_STEP and each dismissal by
 * DISMISS_STEP, and the product is held between FLOOR and CAP. The floor means
 * a field you turned down a few times still comes up now and then, so the feed
 * can find out you have changed your mind; the cap means one or two saves
 * cannot crowd out everything else you write about.
 *
 * Worked from the cards at draw time rather than kept in a table of its own:
 * the action is already on the card with `acted_at`, the pass already reads
 * every card for the person, and a second copy would have to be kept in step
 * with the first.
 */

/** Each save multiplies the weight by this. */
export const SAVE_STEP = 1.4;
/** Each Not interested multiplies the weight by this. */
export const DISMISS_STEP = 0.7;
/** The weight never falls below this, however many dismissals. */
export const PREFERENCE_FLOOR = 0.2;
/** The weight never rises above this, however many saves. */
export const PREFERENCE_CAP = 3;

export type Signals = { saved: number; dismissed: number };

/** What the draw needs: the signals on each theme and on each field. */
export type FeedPreferences = {
  themes: ReadonlyMap<string, Signals>;
  fields: ReadonlyMap<string, Signals>;
};

export const NO_PREFERENCES: FeedPreferences = { themes: new Map(), fields: new Map() };

/** The columns of a feed card this reads. */
export type CardSignal = {
  status: string;
  theme_id: string | null;
  field_id: string | null;
  saved_reading_id: string | null;
};

function add(map: Map<string, Signals>, id: string, kind: keyof Signals) {
  const signals = map.get(id) ?? { saved: 0, dismissed: 0 };
  signals[kind] += 1;
  map.set(id, signals);
}

/**
 * Counts saves and dismissals per theme and per field.
 *
 * An interest card counts towards its theme and its field; a gap card has no
 * theme and counts towards its field only.
 */
export function preferencesFrom(cards: readonly CardSignal[]): FeedPreferences {
  const themes = new Map<string, Signals>();
  const fields = new Map<string, Signals>();
  for (const card of cards) {
    const kind: keyof Signals | null =
      card.saved_reading_id !== null ? 'saved' : card.status === 'dismissed' ? 'dismissed' : null;
    if (!kind) continue;
    if (card.theme_id) add(themes, card.theme_id, kind);
    if (card.field_id) add(fields, card.field_id, kind);
  }
  return { themes, fields };
}

function clamp(value: number): number {
  return Math.min(PREFERENCE_CAP, Math.max(PREFERENCE_FLOOR, value));
}

function factor(signals: Signals | undefined): number {
  if (!signals) return 1;
  return SAVE_STEP ** signals.saved * DISMISS_STEP ** signals.dismissed;
}

/** The multiplier on a field, for drawing gap fields. */
export function fieldWeight(preferences: FeedPreferences, fieldId: string): number {
  return clamp(factor(preferences.fields.get(fieldId)));
}

/**
 * The multiplier on a theme's strength. The theme's own signals and its
 * field's are multiplied and then held between the floor and the cap once, so
 * a card turned down moves its own theme further than the theme's neighbours
 * in the same field.
 */
export function themeWeight(preferences: FeedPreferences, themeId: string, fieldId: string): number {
  return clamp(factor(preferences.themes.get(themeId)) * factor(preferences.fields.get(fieldId)));
}

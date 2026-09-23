import { describe, expect, it } from 'vitest';
import {
  DISMISS_STEP,
  PREFERENCE_CAP,
  PREFERENCE_FLOOR,
  SAVE_STEP,
  fieldWeight,
  preferencesFrom,
  themeWeight,
  type CardSignal,
} from './preference';
import { createDrawer, type FeedField, type FeedTheme, type FieldTests } from './targets';

/**
 * Leaning Learn now towards what you save and away from what you turn down
 * (plan #809). The cases: only Save and Not interested count, the weight moves
 * the right way and stays between the floor and the cap, and the draw follows
 * it for both themes and gap fields.
 */

function card(overrides: Partial<CardSignal>): CardSignal {
  return { status: 'ready', theme_id: null, field_id: null, saved_reading_id: null, ...overrides };
}

function field(id: string): FeedField {
  return { id, slug: id, name: id.toUpperCase(), scope: `${id} scope`, domain: 'D' };
}

function theme(id: string, fieldId: string, strength: number): FeedTheme {
  return { id, name: `Theme ${id}`, about: `About ${id}`, strength, fieldId };
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

describe('counting what you did with cards', () => {
  it('counts saves and dismissals, and nothing else', () => {
    const preferences = preferencesFrom([
      card({ status: 'dismissed', theme_id: 't1', field_id: 'a' }),
      card({ status: 'saved', theme_id: 't1', field_id: 'a', saved_reading_id: 'r1' }),
      // Saved and then tested keeps its reading, so it is still a save.
      card({ status: 'tested', theme_id: 't1', field_id: 'a', saved_reading_id: 'r2' }),
      card({ status: 'dismissed', field_id: 'b' }),
      card({ status: 'opened', theme_id: 't1', field_id: 'a' }),
      card({ status: 'tested', theme_id: 't1', field_id: 'a' }),
      card({ status: 'ready', theme_id: 't1', field_id: 'a' }),
    ]);
    expect(preferences.themes.get('t1')).toEqual({ saved: 2, dismissed: 1 });
    expect(preferences.fields.get('a')).toEqual({ saved: 2, dismissed: 1 });
    expect(preferences.fields.get('b')).toEqual({ saved: 0, dismissed: 1 });
    expect(preferences.themes.size).toBe(1);
  });

  it('leaves the weights alone however many cards you pressed Next on', () => {
    const passed = preferencesFrom(
      Array.from({ length: 30 }, () => card({ status: 'passed', theme_id: 't1', field_id: 'a' })),
    );
    expect(passed.themes.size).toBe(0);
    expect(passed.fields.size).toBe(0);
    expect(themeWeight(passed, 't1', 'a')).toBe(1);
    expect(fieldWeight(passed, 'a')).toBe(1);
  });

  it('lowers a field for each dismissal and raises it for each save, within the floor and the cap', () => {
    const dismissed = (n: number) =>
      preferencesFrom(Array.from({ length: n }, () => card({ status: 'dismissed', field_id: 'a' })));
    const saved = (n: number) =>
      preferencesFrom(Array.from({ length: n }, (_, i) => card({ field_id: 'a', saved_reading_id: `r${i}` })));

    expect(fieldWeight(dismissed(0), 'a')).toBe(1);
    expect(fieldWeight(dismissed(1), 'a')).toBeCloseTo(DISMISS_STEP);
    expect(fieldWeight(dismissed(2), 'a')).toBeCloseTo(DISMISS_STEP ** 2);
    expect(fieldWeight(dismissed(20), 'a')).toBe(PREFERENCE_FLOOR);
    expect(fieldWeight(saved(1), 'a')).toBeCloseTo(SAVE_STEP);
    expect(fieldWeight(saved(20), 'a')).toBe(PREFERENCE_CAP);
  });

  it('moves the theme a card was about further than its neighbours in the field', () => {
    const preferences = preferencesFrom([card({ status: 'dismissed', theme_id: 't1', field_id: 'a' })]);
    expect(themeWeight(preferences, 't1', 'a')).toBeCloseTo(DISMISS_STEP ** 2);
    expect(themeWeight(preferences, 't2', 'a')).toBeCloseTo(DISMISS_STEP);
    expect(themeWeight(preferences, 't3', 'b')).toBe(1);
  });
});

describe('the draw follows it', () => {
  const fields = [field('a'), field('b'), field('c')];
  const noTests = new Map<string, FieldTests>();

  function share(cards: CardSignal[], pick: (drawer: ReturnType<typeof createDrawer>) => string | null) {
    const random = seeded(11);
    const preferences = preferencesFrom(cards);
    const counts = new Map<string, number>();
    for (let i = 0; i < 2000; i += 1) {
      const drawer = createDrawer({
        themes: [theme('t1', 'a', 5), theme('t2', 'b', 5)],
        fields,
        tests: noTests,
        recentThemeIds: new Set(),
        recentFieldIds: new Set(),
        preferences,
        random,
      });
      const id = pick(drawer);
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }

  const interestField = (drawer: ReturnType<typeof createDrawer>) => {
    const target = drawer.next(false);
    return target?.reason === 'interest' ? target.field.id : null;
  };
  const gapField = (drawer: ReturnType<typeof createDrawer>) => {
    const target = drawer.next(true);
    return target?.reason === 'gap' ? target.field.id : null;
  };

  it('draws interest cards from a field less often after several Not interested', () => {
    const before = share([], interestField).get('a') ?? 0;
    const after =
      share(
        Array.from({ length: 3 }, () => card({ status: 'dismissed', theme_id: 't1', field_id: 'a' })),
        interestField,
      ).get('a') ?? 0;
    expect(before).toBeGreaterThan(900);
    expect(after).toBeLessThan(400);
  });

  it('draws interest cards from a field more often after saves', () => {
    const after =
      share(
        [1, 2].map((i) => card({ theme_id: 't1', field_id: 'a', saved_reading_id: `r${i}` })),
        interestField,
      ).get('a') ?? 0;
    expect(after).toBeGreaterThan(1400);
  });

  it('draws a gap field less often after Not interested, without changing which kind of gap comes first', () => {
    // a and b are written about and untested, so both are untested gaps; c is untouched.
    const before = share([], gapField);
    const after = share(
      Array.from({ length: 3 }, () => card({ status: 'dismissed', field_id: 'a' })),
      gapField,
    );
    expect(before.get('a') ?? 0).toBeGreaterThan(900);
    // 0.7 cubed against 1: about a quarter of draws, down from a half.
    expect(after.get('a') ?? 0).toBeLessThan(650);
    expect(after.get('c') ?? 0).toBe(0);
  });
});

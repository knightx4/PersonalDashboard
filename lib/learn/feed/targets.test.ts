import { describe, expect, it } from 'vitest';
import {
  createDrawer,
  gapFields,
  wantsGap,
  wantsGoal,
  type FeedField,
  type FeedGoal,
  type FeedTheme,
  type FieldTests,
} from './targets';

/**
 * Choosing what Learn now cards are about.
 *
 * The cases that matter: the three-to-one split holds whatever the dice do,
 * strong themes are drawn more often than weak ones, the gap order is the
 * spec's (written about and untested, then untouched), and nothing recent or
 * already drawn comes back.
 */

function field(id: string): FeedField {
  return { id, slug: id, name: id.toUpperCase(), scope: `${id} scope`, domain: 'D' };
}

function theme(id: string, fieldId: string, strength: number): FeedTheme {
  return { id, name: `Theme ${id}`, about: `About ${id}`, strength, fieldId };
}

/** A seeded generator, so a test that draws many times is repeatable. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

function goal(id: string, fieldOf: FeedField | null = null): FeedGoal {
  return { id, name: `Goal ${id}`, about: null, depth: 'working', field: fieldOf, domain: null };
}

const noTests = new Map<string, FieldTests>();

describe('the three-to-one split', () => {
  it('asks for a gap only while gap cards are under a quarter of all cards', () => {
    expect(wantsGap({ interest: 0, gap: 0 })).toBe(false);
    expect(wantsGap({ interest: 3, gap: 0 })).toBe(true);
    expect(wantsGap({ interest: 3, gap: 1 })).toBe(false);
    expect(wantsGap({ interest: 9, gap: 3 })).toBe(false);
    expect(wantsGap({ interest: 10, gap: 3 })).toBe(true);
  });

  it('settles near three in four when each target yields three cards', () => {
    const counts = { interest: 0, gap: 0 };
    for (let i = 0; i < 400; i += 1) counts[wantsGap(counts) ? 'gap' : 'interest'] += 3;
    const share = counts.gap / (counts.gap + counts.interest);
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.3);
  });
});

describe('the gap fields', () => {
  const fields = [field('a'), field('b'), field('c'), field('d'), field('e')];
  // a is the strongest field; b holds a fifth of that, which is written about;
  // c holds a twentieth, which is a stray note rather than a subject.
  const themes = [theme('t1', 'a', 10), theme('t2', 'b', 2), theme('t3', 'c', 0.5)];

  it('lists written-about fields with nothing answered first, then empty fields', () => {
    const tests = new Map<string, FieldTests>([
      ['a', { tracks: 1, answered: 4 }],
      ['e', { tracks: 1, answered: 0 }],
    ]);
    const gaps = gapFields(fields, themes, tests);
    expect(gaps.untested.map((f) => f.id)).toEqual(['b']);
    // c has a theme and e has a track, so neither is untouched.
    expect(gaps.untouched.map((f) => f.id)).toEqual(['d']);
  });

  it('counts a written-about field with a track and nothing answered as untested', () => {
    const tests = new Map<string, FieldTests>([['b', { tracks: 2, answered: 0 }]]);
    expect(gapFields(fields, themes, tests).untested.map((f) => f.id)).toEqual(['a', 'b']);
  });
});

describe('drawing targets', () => {
  const fields = [field('a'), field('b'), field('c')];

  it('draws strong themes more often than weak ones', () => {
    const themes = [theme('strong', 'a', 9), theme('weak', 'a', 1)];
    const random = seeded(7);
    let strong = 0;
    for (let i = 0; i < 1000; i += 1) {
      const drawer = createDrawer({
        themes,
        fields,
        tests: noTests,
        recentThemeIds: new Set(),
        recentFieldIds: new Set(),
        random,
      });
      const target = drawer.next(false);
      if (target?.reason === 'interest' && target.theme.id === 'strong') strong += 1;
    }
    expect(strong).toBeGreaterThan(820);
    expect(strong).toBeLessThan(970);
  });

  it('skips recent targets and never draws one twice', () => {
    const themes = [theme('t1', 'a', 5), theme('t2', 'a', 5), theme('t3', 'b', 5)];
    const drawer = createDrawer({
      themes,
      fields,
      tests: noTests,
      recentThemeIds: new Set(['t1']),
      recentFieldIds: new Set(),
      random: seeded(1),
    });
    const drawn = [drawer.next(false), drawer.next(false), drawer.next(false)];
    const ids = drawn.flatMap((t) => (t?.reason === 'interest' ? [t.theme.id] : []));
    expect(new Set(ids)).toEqual(new Set(['t2', 't3']));
    // With both themes spent, the third draw falls through to a gap: a and b
    // are written about and untested, so one of them comes before empty c.
    expect(drawn[2]).toMatchObject({ reason: 'gap', gap: 'untested' });
  });

  it('draws the untested gap before the untouched one, and skips recent gaps', () => {
    const themes = [theme('t1', 'a', 10), theme('t2', 'b', 5)];
    const tests = new Map<string, FieldTests>([['a', { tracks: 1, answered: 3 }]]);
    const drawer = createDrawer({
      themes,
      fields,
      tests,
      recentThemeIds: new Set(),
      recentFieldIds: new Set(),
      random: seeded(3),
    });
    expect(drawer.next(true)).toMatchObject({ reason: 'gap', gap: 'untested', field: { id: 'b' } });
    expect(drawer.next(true)).toMatchObject({ reason: 'gap', gap: 'untouched', field: { id: 'c' } });

    const recent = createDrawer({
      themes,
      fields,
      tests,
      recentThemeIds: new Set(),
      recentFieldIds: new Set(['b']),
      random: seeded(3),
    });
    expect(recent.next(true)).toMatchObject({ reason: 'gap', field: { id: 'c' } });
  });

  it('leaves out themes with no strength and returns null once everything is spent', () => {
    const drawer = createDrawer({
      themes: [theme('t1', 'a', 0)],
      fields: [field('a')],
      tests: noTests,
      recentThemeIds: new Set(),
      recentFieldIds: new Set(),
    });
    // a holds a theme, so it is not untouched; with no strength it is not written about.
    expect(drawer.next(false)).toBeNull();
  });
});

describe('the one-in-three share for goals', () => {
  it('asks for a goal while goal cards are at or under a third of the cards since goals began', () => {
    expect(wantsGoal({ goal: 0, total: 0 })).toBe(true);
    expect(wantsGoal({ goal: 2, total: 2 })).toBe(false);
    expect(wantsGoal({ goal: 2, total: 5 })).toBe(false);
    expect(wantsGoal({ goal: 2, total: 6 })).toBe(true);
    expect(wantsGoal({ goal: 10, total: 29 })).toBe(false);
  });

  it('settles near one in three, with themes and gaps still three to one in the rest', () => {
    const picked = { interest: 0, gap: 0, goal: 0 };
    const window = { goal: 0, total: 0 };
    for (let i = 0; i < 600; i += 1) {
      const kind = wantsGoal(window) ? 'goal' : wantsGap(picked) ? 'gap' : 'interest';
      // Targets yield two or three cards.
      const cards = 2 + (i % 2);
      picked[kind] += cards;
      window.total += cards;
      if (kind === 'goal') window.goal += cards;
    }
    const total = picked.interest + picked.gap + picked.goal;
    expect(picked.goal / total).toBeGreaterThan(0.3);
    expect(picked.goal / total).toBeLessThan(0.37);
    expect(picked.gap / (picked.gap + picked.interest)).toBeGreaterThan(0.2);
    expect(picked.gap / (picked.gap + picked.interest)).toBeLessThan(0.3);
  });
});

describe('drawing goals', () => {
  const fields = [field('a'), field('b')];
  const themes = [theme('t1', 'a', 5), theme('t2', 'b', 5)];
  const base = { themes, fields, tests: noTests, recentThemeIds: new Set<string>(), recentFieldIds: new Set<string>() };

  it('draws a goal when one is asked for, with its field, and a theme otherwise', () => {
    const urbanism = goal('g1', field('a'));
    const drawer = createDrawer({ ...base, goals: [urbanism], random: seeded(2) });
    expect(drawer.next(false, true)).toEqual({ reason: 'goal', goal: urbanism });
    expect(drawer.next(false, false)).toMatchObject({ reason: 'interest' });
  });

  it('passes over a goal drawn recently for one that was not', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const drawer = createDrawer({
        ...base,
        goals: [goal('g1'), goal('g2')],
        recentAimIds: new Set(['g1']),
        random: seeded(seed),
      });
      expect(drawer.next(false, true)).toMatchObject({ reason: 'goal', goal: { id: 'g2' } });
    }
  });

  it('still draws the only goal when it is recent, so a single goal keeps its share', () => {
    const drawer = createDrawer({ ...base, goals: [goal('g1')], recentAimIds: new Set(['g1']), random: seeded(4) });
    expect(drawer.next(false, true)).toMatchObject({ reason: 'goal', goal: { id: 'g1' } });
    // Asked for again in the same pass, it comes back: the naming call is told
    // the articles already picked, so the cards differ.
    expect(drawer.next(false, true)).toMatchObject({ reason: 'goal', goal: { id: 'g1' } });
  });

  it('prefers a goal not yet drawn in this pass', () => {
    const drawer = createDrawer({ ...base, goals: [goal('g1'), goal('g2')], random: seeded(5) });
    const first = drawer.next(false, true);
    const second = drawer.next(false, true);
    const ids = [first, second].map((target) => (target?.reason === 'goal' ? target.goal.id : null));
    expect(new Set(ids)).toEqual(new Set(['g1', 'g2']));
  });

  it('falls back to a goal only once themes and gaps are spent, and never draws it twice then', () => {
    const drawer = createDrawer({
      themes: [],
      fields: [field('a')],
      tests: new Map([['a', { tracks: 1, answered: 1 }]]),
      recentThemeIds: new Set(),
      recentFieldIds: new Set(),
      goals: [goal('g1')],
    });
    expect(drawer.next(false)).toMatchObject({ reason: 'goal', goal: { id: 'g1' } });
    expect(drawer.next(false)).toBeNull();
  });

  it('falls back to themes and gaps when there is no goal to draw', () => {
    const drawer = createDrawer({ ...base, random: seeded(6) });
    expect(drawer.next(false, true)).toMatchObject({ reason: 'interest' });
    expect(drawer.next(true, true)).toMatchObject({ reason: 'gap' });
  });
});

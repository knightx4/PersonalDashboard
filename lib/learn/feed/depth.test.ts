import { describe, expect, it } from 'vitest';
import { contextFor, depthFor, describeDepth, progressFrom, type CardSwipe } from './depth';

/**
 * How deep a pick goes, from what the person swiped.
 *
 * The owner found the first cards too easy: every pick now starts past the
 * basics, and each theme goes deeper as its cards are swiped down as known.
 */

function swipe(overrides: Partial<CardSwipe>): CardSwipe {
  return {
    status: 'known',
    theme_id: 't1',
    field_id: 'econ',
    aim_id: null,
    reason: 'interest',
    title: 'A: B',
    difficulty: null,
    ...overrides,
  };
}

describe('the level', () => {
  it('starts past the basics and rises with known cards', () => {
    expect(depthFor(0)).toBe('working');
    expect(depthFor(1)).toBe('working');
    expect(depthFor(2)).toBe('advanced');
    expect(depthFor(5)).toBe('specialist');
  });

  it('never tells the model to write an introduction', () => {
    expect(describeDepth('working')).toContain('already know the definitions');
  });
});

describe('the swipes on a target', () => {
  const cards: CardSwipe[] = [
    swipe({ title: 'Cobweb model' }),
    swipe({ title: 'Price elasticity of demand: Determinants' }),
    swipe({ status: 'review', title: 'Giffen good' }),
    swipe({ status: 'skipped', title: 'Ignored' }),
    swipe({ theme_id: 't2', title: 'Other theme' }),
    swipe({
      reason: 'gap',
      theme_id: null,
      field_id: 'phys',
      title: 'Entropy: Statistical mechanics',
    }),
  ];
  const progress = progressFrom(cards);

  it('counts known and review per theme, in the order given, and ignores other statuses', () => {
    expect(contextFor(progress, { reason: 'interest', themeId: 't1' })).toEqual({
      depth: 'advanced',
      known: ['Cobweb model', 'Price elasticity of demand: Determinants'],
      review: ['Giffen good'],
      tooHard: [],
    });
  });

  it('keeps themes apart, and counts gap cards towards their field only', () => {
    expect(contextFor(progress, { reason: 'interest', themeId: 't2' }).depth).toBe('working');
    expect(contextFor(progress, { reason: 'gap', fieldId: 'phys' }).known).toEqual([
      'Entropy: Statistical mechanics',
    ]);
    // An interest card does not move its field's gap level.
    expect(contextFor(progress, { reason: 'gap', fieldId: 'econ' }).known).toEqual([]);
  });

  it('starts an unseen target at the lowest level with nothing to go past', () => {
    expect(contextFor(progress, { reason: 'interest', themeId: 'new' })).toEqual({
      depth: 'working',
      known: [],
      review: [],
      tooHard: [],
    });
  });
});

describe('the Too hard and Too easy ratings', () => {
  const on = (cards: CardSwipe[], target: Parameters<typeof contextFor>[1]) =>
    contextFor(progressFrom(cards), target);
  const theme = { reason: 'interest', themeId: 't1' } as const;

  it('raises a theme a level for each card rated too easy, swiped or not', () => {
    // One known card alone is working; a second card rated too easy, never
    // swiped, lifts it to advanced.
    expect(
      on([swipe({ title: 'Cobweb model' }), swipe({ status: 'ready', difficulty: 'too_easy', title: 'Tariff' })], theme)
        .depth,
    ).toBe('advanced');
    // A card swiped known and rated too easy counts for both.
    expect(on([swipe({ difficulty: 'too_easy', title: 'Cobweb model' })], theme).depth).toBe('advanced');
  });

  it('lowers a theme for each card rated too hard, and passes those titles on', () => {
    const cards = [
      swipe({ status: 'ready', difficulty: 'too_hard', title: 'Arrow-Debreu model' }),
      swipe({ title: 'Cobweb model' }),
      swipe({ title: 'Tariff' }),
    ];
    // Two known is advanced; one Too hard takes it back to working.
    expect(on(cards, theme)).toEqual({
      depth: 'working',
      known: ['Cobweb model', 'Tariff'],
      review: [],
      tooHard: ['Arrow-Debreu model'],
    });
  });

  it('keeps working as the floor when Too hard is pressed at the lowest level', () => {
    const cards = [
      swipe({ status: 'ready', difficulty: 'too_hard', title: 'Arrow-Debreu model' }),
      swipe({ status: 'ready', difficulty: 'too_hard', title: 'Walras law' }),
      swipe({ title: 'Cobweb model' }),
      swipe({ title: 'Tariff' }),
    ];
    // Still working, and the titles go to the naming call so the next pick
    // comes at those ideas from a simpler angle.
    expect(on(cards, theme)).toMatchObject({
      depth: 'working',
      tooHard: ['Arrow-Debreu model', 'Walras law'],
    });
    // The count is net: Too easy has to outweigh Too hard before it lifts.
    expect(
      on(
        [
          swipe({ status: 'ready', difficulty: 'too_hard', title: 'Arrow-Debreu model' }),
          swipe({ status: 'ready', difficulty: 'too_easy', title: 'Tariff' }),
          swipe({ status: 'ready', difficulty: 'too_easy', title: 'Quota' }),
          swipe({ status: 'ready', difficulty: 'too_easy', title: 'Subsidy' }),
        ],
        theme,
      ).depth,
    ).toBe('advanced');
  });

  it('moves a gap card\'s field the same way, and leaves the theme alone', () => {
    const gap = (overrides: Partial<CardSwipe>) =>
      swipe({ reason: 'gap', theme_id: null, field_id: 'phys', ...overrides });
    const field = { reason: 'gap', fieldId: 'phys' } as const;
    expect(
      on([gap({ status: 'ready', difficulty: 'too_easy', title: 'Entropy' }), gap({ title: 'Heat engine' })], field)
        .depth,
    ).toBe('advanced');
    expect(
      on(
        [
          gap({ status: 'ready', difficulty: 'too_hard', title: 'Entropy' }),
          gap({ title: 'Heat engine' }),
          gap({ title: 'Carnot cycle' }),
        ],
        field,
      ),
    ).toMatchObject({ depth: 'working', tooHard: ['Entropy'] });
    expect(on([gap({ difficulty: 'too_easy', title: 'Entropy' })], theme).depth).toBe('working');
  });

  it('ignores a rating on a card with no title', () => {
    expect(on([swipe({ status: 'ready', difficulty: 'too_hard', title: null })], theme).tooHard).toEqual([]);
  });
});

describe('a goal', () => {
  // cardDepthForAim in lib/learn/aims.ts maps familiar, solid and deep to
  // working, advanced and specialist; these are those starts.
  const familiar = { reason: 'goal', aimId: 'g1', start: 'working' } as const;
  const solid = { reason: 'goal', aimId: 'g1', start: 'advanced' } as const;
  const goalCard = (overrides: Partial<CardSwipe>) =>
    swipe({ reason: 'goal', theme_id: null, field_id: null, aim_id: 'g1', ...overrides });
  const on = (cards: CardSwipe[], target: Parameters<typeof contextFor>[1]) =>
    contextFor(progressFrom(cards), target);

  it('starts at the depth set on it', () => {
    expect(on([], familiar)).toEqual({ depth: 'working', known: [], review: [], tooHard: [] });
    expect(on([], solid)).toEqual({ depth: 'advanced', known: [], review: [], tooHard: [] });
  });

  it('moves a familiar goal from working to advanced after two cards swiped known', () => {
    const cards = [goalCard({ title: 'Runway: Burn multiple' }), goalCard({ title: 'SaaS metrics: Net retention' })];
    expect(on(cards.slice(0, 1), familiar).depth).toBe('working');
    expect(on(cards, familiar)).toMatchObject({
      depth: 'advanced',
      known: ['Runway: Burn multiple', 'SaaS metrics: Net retention'],
    });
  });

  it('goes on from advanced for a solid goal, and Too hard brings it back', () => {
    const known = ['A', 'B', 'C'].map((title) => goalCard({ title }));
    expect(on(known, solid).depth).toBe('specialist');
    expect(on([goalCard({ status: 'ready', difficulty: 'too_hard', title: 'Hard' })], solid)).toMatchObject({
      depth: 'working',
      tooHard: ['Hard'],
    });
  });

  it('passes the cards swiped as needing work as titles to come at differently, without going deeper', () => {
    const cards = [
      goalCard({ status: 'review', title: 'Cap table: Pro rata' }),
      goalCard({ status: 'review', title: 'Venture debt: Warrants' }),
    ];
    expect(on(cards, familiar)).toEqual({
      depth: 'working',
      known: [],
      review: ['Cap table: Pro rata', 'Venture debt: Warrants'],
      tooHard: [],
    });
  });

  it('counts only its own cards, and its cards move no theme, field or other goal', () => {
    const cards = [
      goalCard({ title: 'A', field_id: 'econ', theme_id: 't1' }),
      goalCard({ title: 'B', field_id: 'econ', theme_id: 't1' }),
      swipe({ title: 'C' }),
      swipe({ title: 'D' }),
    ];
    expect(on(cards, familiar).known).toEqual(['A', 'B']);
    expect(on(cards, { reason: 'goal', aimId: 'g2', start: 'working' }).depth).toBe('working');
    expect(on(cards, { reason: 'interest', themeId: 't1' }).known).toEqual(['C', 'D']);
    expect(on(cards, { reason: 'gap', fieldId: 'econ' }).known).toEqual([]);
  });
});

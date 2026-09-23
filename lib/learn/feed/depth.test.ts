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
    reason: 'interest',
    title: 'A: B',
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
    });
  });
});

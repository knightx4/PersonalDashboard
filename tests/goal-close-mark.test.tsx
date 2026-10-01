/**
 * A goal closing on its page (plan #1341): the hexagon completes and the
 * steps fold, but a page that loads with the goal already closed draws the
 * end state with nothing playing.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GoalGlyph, GoalStepsFold } from '@/app/goals/[goalId]/goal-close';
import { goalGlyph } from '@/lib/goals/status';

describe('goalGlyph', () => {
  it('fills an open goal a quarter at a time and keeps solid for the close', () => {
    expect(goalGlyph('open', { live: 0, done: 0 }).glyph).toBe('empty');
    expect(goalGlyph('open', { live: 8, done: 0 }).glyph).toBe('empty');
    expect(goalGlyph('open', { live: 8, done: 1 }).glyph).toBe('quarter');
    expect(goalGlyph('open', { live: 8, done: 4 }).glyph).toBe('half');
    expect(goalGlyph('open', { live: 8, done: 6 }).glyph).toBe('three-quarters');
    expect(goalGlyph('open', { live: 8, done: 8 }).glyph).toBe('three-quarters');
    expect(goalGlyph('done', { live: 8, done: 8 }).glyph).toBe('full');
  });

  it('draws the other states as the plan does and names each', () => {
    expect(goalGlyph('parked', { live: 3, done: 1 })).toEqual({ glyph: 'dashed', label: 'Parked' });
    expect(goalGlyph('dropped', { live: 3, done: 1 }).glyph).toBe('slash');
    expect(goalGlyph('proposed', { live: 0, done: 0 }).glyph).toBe('empty');
    expect(goalGlyph('open', { live: 8, done: 3 }).label).toBe('Open, 3 of 8 steps done');
    expect(goalGlyph('done', { live: 8, done: 8 }).label).toBe('Closed');
  });
});

describe('a goal page loaded with the goal already closed', () => {
  it('draws the solid hexagon with no ring', () => {
    const html = renderToStaticMarkup(<GoalGlyph glyph="full" label="Closed" closed />);
    expect(html).toContain('<title>Closed</title>');
    expect(html).not.toContain('goal-ring');
  });

  it('shows the steps folded into one line, with no fold playing', () => {
    const html = renderToStaticMarkup(
      <GoalStepsFold closed meta="3 of 3 done">
        <p>the steps</p>
      </GoalStepsFold>,
    );
    expect(html).toContain('<details');
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(html).toContain('3 of 3 done');
    expect(html).not.toContain('goal-fold');
  });

  it('leaves an open goal’s steps as they are', () => {
    const html = renderToStaticMarkup(
      <GoalStepsFold closed={false}>
        <p>the steps</p>
      </GoalStepsFold>,
    );
    expect(html).not.toContain('<details');
    expect(html).not.toContain('goal-fold');
    expect(html).toContain('the steps');
  });
});

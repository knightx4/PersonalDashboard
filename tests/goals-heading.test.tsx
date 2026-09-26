/**
 * A goal's title and done-when, editable at the head of its own page
 * (note 3e11d846).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const { GoalHeadingField } = await import('@/app/goals/[goalId]/goal-heading');

describe('the goal heading', () => {
  it('draws the title as a button that opens it for editing', () => {
    const html = renderToStaticMarkup(
      <GoalHeadingField goalId="g" field="title" value="Clear the card debt" />,
    );
    expect(html).toContain('<button');
    expect(html).toContain('title="Edit the goal"');
    expect(html).toContain('Clear the card debt');
  });

  it('offers a done-when where there is none', () => {
    const html = renderToStaticMarkup(
      <GoalHeadingField goalId="g" field="acceptance" value={null} />,
    );
    expect(html).toContain('Add when it is done…');
  });
});

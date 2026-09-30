/**
 * Todo's line about Dash's unread results (plan #1268): the count, linked to
 * where the results are read on the Goals home, and nothing at zero.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashResultsLine } from '@/components/todo/dash-results-line';

describe('DashResultsLine', () => {
  it('says how many and links to the Goals home section they are read in', () => {
    const html = renderToStaticMarkup(<DashResultsLine count={2} />);
    expect(html).toContain('href="/goals#done-heading"');
    expect(html).toContain('Dash finished 2 things for you');
  });

  it('says one thing in the singular', () => {
    expect(renderToStaticMarkup(<DashResultsLine count={1} />)).toContain('Dash finished 1 thing for you');
  });

  it('draws nothing at zero', () => {
    expect(renderToStaticMarkup(<DashResultsLine count={0} />)).toBe('');
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { shorten, wrap } from './diagram';
import { flowColumns, flowKind } from './flow';
import { cycleKind } from './cycle';
import { treeKind } from './tree';
import { twoByTwoKind } from './two-by-two';
import { timelineKind } from './timeline';

describe('the diagram kinds (plan #2321.2)', () => {
  it('wrap labels to lines, breaking a long word and ending an overflow with an ellipsis', () => {
    expect(wrap('Households bid more for land nearby', 16)).toEqual(['Households bid', 'more for land', 'nearby']);
    expect(wrap('Agglomeration', 8)).toEqual(['Agglome-', 'ration']);
    expect(wrap('one two three four five six', 7, 2)).toEqual(['one two', 'three…']);
  });

  it('shorten a long label at a word rather than refuse it', () => {
    expect(shorten('First large electric streetcar system opens in Richmond', 48)).toBe('First large electric streetcar system opens in…');
    expect(shorten('Short', 48)).toBe('Short');
  });

  it('flow puts each step in the column of its longest chain, and refuses a loop', () => {
    expect(flowColumns(flowKind.example.spec)).toEqual([['line'], ['commute'], ['bids'], ['owners', 'renters', 'dense']]);
    const steps = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ];
    expect(flowColumns({ steps })).toEqual([['a'], ['b']]);
    const loop = { steps, links: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }] };
    expect(flowColumns(loop)).toBeNull();
    expect(flowKind.schema.safeParse(loop).success).toBe(false);
    expect(flowKind.schema.safeParse({ steps, links: [{ from: 'a', to: 'z' }] }).success).toBe(false);
  });

  it('refuse a spec past their counts, and shorten labels past their caps, so a diagram stays readable on a phone', () => {
    expect(cycleKind.schema.safeParse({ stages: ['One', 'Two'] }).success).toBe(false);
    const long = cycleKind.schema.safeParse({ stages: ['One', 'Two', 'Workers and firms match far better than before'] });
    expect(long.success && long.data.stages[2]).toBe('Workers and firms match far…');
    const leaves = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `Leaf ${i}` }));
    expect(
      treeKind.schema.safeParse({
        root: 'All',
        children: [
          { label: 'A', children: leaves(3) },
          { label: 'B', children: leaves(3) },
          { label: 'C' },
        ],
      }).success,
    ).toBe(false);
    const square = twoByTwoKind.example.spec;
    expect(twoByTwoKind.schema.safeParse({ ...square, items: [{ label: 'Off the edge', x: 1.2, y: 0.5 }] }).success).toBe(false);
    expect(timelineKind.schema.safeParse({ events: [{ date: '1908', label: 'One event' }] }).success).toBe(false);
  });

  it('draw a phone, a wide and a large layout where the shape changes, and one drawing where it does not', () => {
    const count = (html: string) => html.match(/<svg/g)?.length ?? 0;
    for (const kind of [flowKind, treeKind, timelineKind]) {
      const html = renderToStaticMarkup(<kind.Render spec={kind.example.spec as never} resolved={null} />);
      expect(count(html), kind.id).toBe(3);
      expect(html).toContain('sm:hidden');
    }
    for (const kind of [cycleKind, twoByTwoKind]) {
      expect(count(renderToStaticMarkup(<kind.Render spec={kind.example.spec as never} resolved={null} />)), kind.id).toBe(1);
    }
  });

  it('colour with theme tokens only, never a fixed colour', () => {
    for (const kind of [flowKind, cycleKind, treeKind, twoByTwoKind, timelineKind]) {
      const html = renderToStaticMarkup(<kind.Render spec={kind.example.spec as never} resolved={null} />);
      expect(html, kind.id).not.toMatch(/(fill|stroke)="(?!none)[^"]+"/);
      expect(html, kind.id).toContain('role="img"');
    }
  });
});

import { describe, expect, it } from 'vitest';
import { gridSpans } from './story-grid';

describe('gridSpans', () => {
  it('fills every row at both widths, whatever the count', () => {
    for (let count = 1; count <= 13; count++) {
      const spans = gridSpans(count);
      const md = spans.reduce((sum, s) => sum + s.md, 0);
      const lg = spans.reduce((sum, s) => sum + s.lg * (s.tall ? 2 : 1), 0);
      expect(md % 2, `md, ${count} stories`).toBe(0);
      expect(lg % 3, `lg, ${count} stories`).toBe(0);
    }
  });

  it('gives the lead two columns and two rows beside two stories on a full page', () => {
    const spans = gridSpans(6);
    expect(spans[0]).toEqual({ md: 2, lg: 2, tall: true });
    expect(spans.slice(1).map((s) => s.lg)).toEqual([1, 1, 1, 1, 1]);
    // Five after the lead leaves one short at md, so the last widens.
    expect(spans[5].md).toBe(2);
  });

  it('keeps the lead one row tall when only one story stands beside it', () => {
    expect(gridSpans(2)).toEqual([
      { md: 2, lg: 2, tall: false },
      { md: 2, lg: 1, tall: false },
    ]);
  });

  it('spreads a lone story across the page', () => {
    expect(gridSpans(1)).toEqual([{ md: 2, lg: 3, tall: false }]);
    expect(gridSpans(0)).toEqual([]);
  });

  it('widens the last story when a row after the lead comes up short', () => {
    expect(gridSpans(4)[3].lg).toBe(3);
    expect(gridSpans(5)[4].lg).toBe(2);
  });
});

describe('gridSpans with a lead that has no picture', () => {
  it('fills every row at both widths, whatever the count', () => {
    for (let count = 1; count <= 13; count++) {
      const spans = gridSpans(count, { tallLead: false });
      const md = spans.reduce((sum, s) => sum + s.md, 0);
      const lg = spans.reduce((sum, s) => sum + s.lg * (s.tall ? 2 : 1), 0);
      expect(md % 2, `md, ${count} stories`).toBe(0);
      expect(lg % 3, `lg, ${count} stories`).toBe(0);
    }
  });

  it('keeps the lead one row tall beside one story (note a5a59857)', () => {
    const spans = gridSpans(6, { tallLead: false });
    expect(spans[0]).toEqual({ md: 2, lg: 2, tall: false });
    // Lead and one beside it, then three, then one widened across the row.
    expect(spans.slice(1).map((s) => s.lg)).toEqual([1, 1, 1, 1, 3]);
    expect(spans.every((s) => !s.tall)).toBe(true);
  });
});

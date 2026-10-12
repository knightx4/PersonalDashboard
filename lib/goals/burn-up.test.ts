import { describe, expect, it } from 'vitest';
import { burnUp, burnUpLabel } from './burn-up';

const size = { width: 600, height: 160 };
const day = (d: string, total: number, done: number) => ({ day: d, total, done });

describe('burnUp', () => {
  it('draws nothing under three days', () => {
    expect(burnUp([], size)).toBeNull();
    expect(burnUp([day('2026-10-01', 3, 1), day('2026-10-02', 4, 1)], size)).toBeNull();
  });

  it('scales both lines from zero to the largest total', () => {
    const chart = burnUp(
      [day('2026-10-01', 4, 0), day('2026-10-02', 6, 2), day('2026-10-03', 10, 5)],
      size,
    )!;
    expect(chart.high).toBe(10);
    expect(chart.y(0)).toBe(chart.plot.bottom);
    expect(chart.y(10)).toBe(chart.plot.top);
    expect(chart.points[0].x).toBe(chart.plot.left);
    expect(chart.points[2].x).toBe(chart.plot.right);
  });

  it('spaces points by calendar day, so a gap is a longer stretch', () => {
    const chart = burnUp(
      [day('2026-10-01', 1, 0), day('2026-10-02', 1, 0), day('2026-10-11', 1, 1)],
      size,
    )!;
    const [a, b, c] = chart.points;
    expect(c.x - b.x).toBeCloseTo((b.x - a.x) * 9);
  });

  it('keeps a scope of zero steps on the baseline', () => {
    const chart = burnUp(
      [day('2026-10-01', 0, 0), day('2026-10-02', 0, 0), day('2026-10-03', 0, 0)],
      size,
    )!;
    expect(chart.high).toBe(1);
    expect(chart.y(0)).toBe(chart.plot.bottom);
  });
});

describe('burnUpLabel', () => {
  it('names the first and last day', () => {
    expect(
      burnUpLabel([day('2026-10-01', 4, 0), day('2026-10-02', 5, 1), day('2026-10-03', 5, 3)]),
    ).toBe('Steps over 3 days: from 0 of 4 done on 2026-10-01 to 3 of 5 done on 2026-10-03');
  });
});

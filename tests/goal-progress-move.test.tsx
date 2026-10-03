/**
 * A goal's progress moving when a step closes (plan #1342): the bar slides by
 * transform and the count counts, but a page that loads draws the final value
 * at once.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GoalProgress } from '@/app/goals/goal-progress';
import { Meter, bandSpans, type Band } from '@/components/ui/meter';
import { countAt } from '@/components/ui/motion';
import type { GoalProgress as Progress } from '@/lib/goals/status';

const progress: Progress = {
  live: 5,
  done: 2,
  bands: { on_you: 2, waiting: 0, with_dash: 1, done: 2 },
  move: 'on_you',
  moves: { on_you: 2, with_dash: 1, waiting: 0, settled: 0 },
  questions: 0,
};

function band(key: string, value: number): Band {
  return { key, value, fill: 'bg-accent', label: `${value} ${key}` };
}

describe('a goal page loaded with steps already closed', () => {
  it('draws the final count and lengths at once', () => {
    const html = renderToStaticMarkup(<GoalProgress progress={progress} label="Pay off the debts" />);
    expect(html).toContain('2 of 5 steps done');
    // done is the last band, two fifths from the right.
    expect(html).toContain('translateX(60.00%) scaleX(0.4000)');
  });

  it('moves by transform, with every band kept so one can grow from nothing', () => {
    const html = renderToStaticMarkup(<GoalProgress progress={progress} label="Pay off the debts" />);
    expect(html).toContain('progress-move');
    expect(html).not.toMatch(/width:/);
    expect(html.match(/progress-move/g)).toHaveLength(4);
    expect(html).toContain('scaleX(0.0000)');
  });
});

describe('bandSpans', () => {
  it('lays the bands end to end across the whole bar', () => {
    const spans = bandSpans([band('a', 1), band('b', 0), band('c', 3)], 0);
    expect(spans.map((s) => [s.start, s.size])).toEqual([
      [0, 0.25],
      [0.25, 0],
      [0.25, 0.75],
    ]);
  });

  it('gives a sliver its floor out of the bands with length to spare', () => {
    const spans = bandSpans([band('a', 1), band('b', 99)], 0.04);
    expect(spans[0].size).toBe(0.04);
    expect(spans[1].size).toBeCloseTo(0.96);
  });

  it('draws nothing for an empty bar', () => {
    expect(bandSpans([band('a', 0)], 0.04)[0].size).toBe(0);
  });
});

describe('the count', () => {
  it('starts where it was and lands exactly on the new value', () => {
    expect(countAt(2, 3, 0, 300)).toBe(2);
    expect(countAt(2, 3, 300, 300)).toBe(3);
    expect(countAt(2, 3, 900, 300)).toBe(3);
    expect(countAt(0, 10, 150, 300)).toBeGreaterThan(5);
  });
});

describe('Meter', () => {
  it('slides its fill rather than sizing it', () => {
    const html = renderToStaticMarkup(<Meter value={1} max={4} label="x" moves />);
    expect(html).toContain('translateX(-75%)');
    expect(html).toContain('progress-move');
  });
});

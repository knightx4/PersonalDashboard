import { describe, expect, it } from 'vitest';
import { dashWork } from './dash-work';
import type { GoalRun } from './shaping';

const NOW = Date.parse('2026-09-29T12:00:00Z');

function run(over: Partial<GoalRun>): GoalRun {
  return {
    id: 'r',
    status: 'started',
    createdAt: '2026-09-29T11:50:00Z',
    endedAt: null,
    summary: null,
    error: null,
    lastSeenAt: '2026-09-29T11:55:00Z',
    nowOn: 'Reading the listing',
    ...over,
  };
}

describe('dashWork', () => {
  it('lists what Dash is on first, then what it finished in the last day, and nothing older or failed', () => {
    const titles = new Map([
      ['going', 'Find shelf arms'],
      ['fresh', 'Price the brackets'],
      ['old', 'Measure the wall'],
      ['failed', 'Book a fitter'],
    ]);
    const items = dashWork(
      {
        fresh: run({ id: 'r2', status: 'done', endedAt: '2026-09-29T09:00:00Z', summary: 'Found three.\nMore.' }),
        going: run({ id: 'r1' }),
        old: run({ id: 'r3', status: 'done', endedAt: '2026-09-27T09:00:00Z', summary: 'Done.' }),
        failed: run({ id: 'r4', status: 'failed', endedAt: '2026-09-29T10:00:00Z', error: 'No access.' }),
      },
      titles,
      NOW,
    );
    expect(items.map((i) => [i.title, i.state])).toEqual([
      ['Find shelf arms', 'running'],
      ['Price the brackets', 'finished'],
    ]);
    expect(items[1].line).toBe('Found three.');
  });
});

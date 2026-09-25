import { describe, expect, it } from 'vitest';
import type { RunListing } from './runs';
import { SINCE_VISIT_SHOWN, sinceVisit, tallyRuns, type RunGoal } from './since-visit';

const SINCE = '2026-09-24T21:00:00.000Z';

function run(id: string, extra: Partial<RunListing> = {}): RunListing {
  return {
    id,
    job: 'step',
    status: 'done',
    createdAt: '2026-09-25T02:00:00Z',
    endedAt: '2026-09-25T02:20:00Z',
    summary: null,
    error: null,
    lastSeenAt: null,
    nowOn: null,
    item: null,
    ...extra,
  };
}

const debt: RunGoal = { id: 'g-debt', title: 'Pay off student debt' };
const city: RunGoal = { id: 'g-city', title: 'Get plugged into the city' };

describe('sinceVisit', () => {
  it('lists two steps worked and a failed run, each linking to its goal', () => {
    const runs = [
      run('r1', { item: { id: 's-autopay', title: 'Turn on autopay', level: 'step' } }),
      run('r2', {
        endedAt: '2026-09-25T03:20:00Z',
        item: { id: 's-rates', title: 'Compare refinance rates', level: 'step' },
      }),
      run('r3', {
        status: 'failed',
        endedAt: '2026-09-25T04:00:00Z',
        error: 'The routine refused the brief.',
        item: { id: 's-events', title: 'Find three meetups', level: 'step' },
      }),
    ];
    const goals = new Map([
      ['s-autopay', debt],
      ['s-rates', debt],
      ['s-events', city],
    ]);
    const list = sinceVisit(SINCE, runs, new Map(), goals);

    expect(list.entries.map((e) => [e.title, e.href, e.failed])).toEqual([
      ['Find three meetups', '/goals/g-city#step-s-events', true],
      ['Compare refinance rates', '/goals/g-debt#step-s-rates', false],
      ['Turn on autopay', '/goals/g-debt#step-s-autopay', false],
    ]);
    expect(list.entries[0].line).toBe('Failed · Sent a step · Get plugged into the city');
    expect(list.entries[0].error).toBe('The routine refused the brief.');
    expect(list.entries[1].line).toBe('Worked this step · Pay off student debt');
    expect(list.more).toBe(0);
  });

  it('says a goal was mapped and counts the facts its run filed', () => {
    const runs = [run('r1', { job: 'goal', item: { id: 'g-debt', title: debt.title, level: 'goal' } })];
    const tallies = tallyRuns([
      { run_id: 'r1', table_name: 'items', action: 'insert', new_values: { level: 'step', kind: 'claude' } },
      { run_id: 'r1', table_name: 'items', action: 'insert', new_values: { level: 'step', kind: 'mine' } },
      { run_id: 'r1', table_name: 'items', action: 'insert', new_values: { level: 'step', kind: 'decision' } },
      { run_id: 'r1', table_name: 'records', action: 'insert', new_values: { id: 'x' } },
      { run_id: 'r1', table_name: 'records', action: 'insert', new_values: { id: 'y' } },
      { run_id: 'r1', table_name: 'items', action: 'update', new_values: { fog: null } },
    ]);
    const [entry] = sinceVisit(SINCE, runs, tallies, new Map([['g-debt', debt]])).entries;
    expect(entry.line).toBe('Mapped this goal · 2 steps proposed · 1 question · 2 facts filed');
    expect(entry.href).toBe('/goals/g-debt');
  });

  it('counts the steps a morning run closed and links to its run page', () => {
    const tallies = tallyRuns([
      { run_id: 'r1', table_name: 'items', action: 'update', new_values: { status: 'done', result: '…' } },
      { run_id: 'r1', table_name: 'items', action: 'update', new_values: { status: 'done' } },
    ]);
    const [entry] = sinceVisit(SINCE, [run('r1', { job: 'daily' })], tallies, new Map()).entries;
    expect(entry).toMatchObject({
      title: 'Morning run',
      line: 'Finished · 2 steps done',
      href: '/goals/runs/r1',
    });
  });

  it('leaves out runs still going and runs that ended before the last visit', () => {
    const runs = [
      run('going', { status: 'started', endedAt: null }),
      run('old', { endedAt: '2026-09-24T20:00:00Z' }),
    ];
    expect(sinceVisit(SINCE, runs, new Map(), new Map()).entries).toEqual([]);
  });

  it('caps the list and counts the rest', () => {
    const runs = Array.from({ length: SINCE_VISIT_SHOWN + 2 }, (_, i) => run(`r${i}`));
    const list = sinceVisit(SINCE, runs, new Map(), new Map());
    expect(list.entries).toHaveLength(SINCE_VISIT_SHOWN);
    expect(list.more).toBe(2);
  });
});

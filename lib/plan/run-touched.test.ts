import { describe, expect, it } from 'vitest';
import { planRunHref, runTouched, type TouchStep } from './run-touched';

function step(over: Partial<TouchStep> & Pick<TouchStep, 'id' | 'number'>): TouchStep {
  return { outline: null, parentId: null, title: `Step ${over.number}`, status: 'not_started', completedAt: null, ...over };
}

const STEPS: TouchStep[] = [
  step({ id: 'f', number: 1964, outline: '1964', title: 'Dash is one presence' }),
  step({ id: 's', number: 2001, outline: '1964.2', parentId: 'f', title: 'One working state' }),
  step({ id: 'a', number: 2002, outline: '1964.2.1', parentId: 's', status: 'done', completedAt: '2026-10-15T09:30:00Z' }),
  step({ id: 'b', number: 2003, outline: '1964.2.2', parentId: 's', status: 'done', completedAt: '2026-10-15T09:10:00Z' }),
  step({ id: 'c', number: 2004, outline: '1964.2.3', parentId: 's', status: 'done', completedAt: '2026-10-15T08:00:00Z' }),
  step({ id: 'd', number: 2005, outline: '1964.2.4', parentId: 's', status: 'done', completedAt: '2026-10-15T12:00:00Z' }),
  step({ id: 'o', number: 1500, outline: '1400.3', title: 'Elsewhere' }),
];

const RUN = {
  planItemId: 's',
  createdAt: '2026-10-15T09:00:00Z',
  endedAt: '2026-10-15T10:00:00Z',
  lastPush: null,
};

describe('runTouched', () => {
  it('lists the step it was sent at, then the steps beneath it closed while it ran, oldest first', () => {
    const { rows } = runTouched({ run: RUN, lines: [], steps: STEPS });
    expect(rows.map((row) => (row.kind === 'step' ? [row.step.outline, row.reason] : null))).toEqual([
      ['1964.2', 'sent'],
      ['1964.2.2', 'closed'],
      ['1964.2.1', 'closed'],
    ]);
    expect(rows[0].href).toBe('/dev/plan/1964.2');
  });

  it('counts a closure after the run ended as a later run’s, and any while it is going as its own', () => {
    const going = runTouched({ run: { ...RUN, endedAt: null }, lines: [], steps: STEPS });
    expect(going.rows.map((row) => row.key)).toEqual(['s', 'b', 'a', 'd']);
  });

  it('reads steps named by outline in lines, and by number only in commit subjects', () => {
    const { rows, commits } = runTouched({
      run: { ...RUN, planItemId: null, lastPush: { sha: '7d2e5a1aaaaaaaa', subject: 'Fix the row (plan #1500)' } },
      lines: [
        { kind: 'action', body: 'Claimed #1964.2.3, found 3 issues #3.' },
        { kind: 'action', body: 'Committed 4be1c09: Add the page' },
        { kind: 'action', body: 'Committed 7d2e5a1' },
      ],
      steps: STEPS,
    });
    expect(rows.map((row) => (row.kind === 'step' ? [row.step.outline, row.reason] : null))).toEqual([
      ['1964.2.3', 'named'],
      ['1400.3', 'commit'],
    ]);
    expect(commits).toEqual([
      { sha: '4be1c09', subject: 'Add the page' },
      { sha: '7d2e5a1aaaaaaaa', subject: 'Fix the row (plan #1500)' },
    ]);
  });

  it('lists the app pages its lines link, a link to a step as that step, and leaves other sites out', () => {
    const { rows } = runTouched({
      run: { ...RUN, planItemId: null },
      lines: [
        {
          kind: 'action',
          body: 'Wrote [the brief](/goals/files/abc) and opened [the step](/dev/plan/1964.2.1); see https://example.com.',
        },
        { kind: 'thought', body: 'Back to [the brief](/goals/files/abc).' },
      ],
      steps: STEPS,
    });
    expect(rows).toEqual([
      { kind: 'page', key: '/goals/files/abc', href: '/goals/files/abc', title: 'the brief', reason: 'linked' },
      expect.objectContaining({ kind: 'step', key: 'a', reason: 'linked' }),
    ]);
  });

  it('names each row once, by the first reason it has', () => {
    const { rows } = runTouched({
      run: RUN,
      lines: [{ kind: 'action', body: 'Claimed #1964.2, and #1964.2.2 closed.' }],
      steps: STEPS,
    });
    expect(rows.filter((row) => row.key === 's')).toHaveLength(1);
    expect(rows.find((row) => row.key === 'b')?.reason).toBe('closed');
  });
});

describe('planRunHref', () => {
  it('opens under the plan', () => {
    expect(planRunHref('6f0c2a7e-1b7d-4c55-9a0e-2d8f3c1b9a01')).toBe('/dev/plan/runs/6f0c2a7e-1b7d-4c55-9a0e-2d8f3c1b9a01');
  });
});

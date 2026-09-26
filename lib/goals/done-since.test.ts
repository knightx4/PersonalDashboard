import { describe, expect, it } from 'vitest';
import { DONE_CHANGES_SHOWN, doneSince, type DoneRun, type ResultStep } from './done-since';
import { changeLines, emptyNames, type HistoryRow } from './run-changes';
import type { RunListing } from './runs';

const SINCE = '2026-09-25T21:00:00.000Z';
const debt = { id: 'g-debt', title: 'Pay off student debt' };

function run(id: string, extra: Partial<RunListing> = {}): RunListing {
  return {
    id,
    job: 'step',
    status: 'done',
    createdAt: '2026-09-26T02:00:00Z',
    endedAt: '2026-09-26T02:20:00Z',
    summary: null,
    error: null,
    lastSeenAt: null,
    nowOn: null,
    item: null,
    ...extra,
  };
}

function history(id: number, extra: Partial<HistoryRow>): HistoryRow {
  return {
    id,
    table_name: 'items',
    row_id: 's-rates',
    action: 'update',
    old_values: null,
    new_values: null,
    actor: 'claude',
    created_at: '2026-09-26T02:10:00Z',
    undoes: null,
    undoes_field: null,
    ...extra,
  };
}

/** A night step run: it starts the step, then stores the result and closes it. */
const stepRows = [
  history(10, { old_values: { status: 'not_started' }, new_values: { status: 'in_progress' } }),
  history(11, {
    old_values: { status: 'in_progress', result: null, closed_at: null },
    new_values: { status: 'done', result: 'Three lenders compared.', closed_at: 'x' },
  }),
];

/** A mapping run that added two steps. */
const mapRows = [
  history(20, { row_id: 's-a', action: 'insert', new_values: { title: 'Call the servicer', level: 'step' } }),
  history(21, { row_id: 's-b', action: 'insert', new_values: { title: 'List the loans', level: 'step' } }),
];

function names() {
  const n = emptyNames();
  n.items.set('s-rates', { title: 'Compare refinance rates', level: 'step', kind: 'claude' });
  n.items.set('s-a', { title: 'Call the servicer', level: 'step', kind: 'mine' });
  n.items.set('s-b', { title: 'List the loans', level: 'step', kind: 'mine' });
  return n;
}

function step(extra: Partial<ResultStep> = {}): ResultStep {
  return {
    id: 's-rates',
    title: 'Compare refinance rates',
    kind: 'claude',
    hasResult: true,
    reviewedAt: null,
    updatedAt: '2026-09-26T02:10:00Z',
    goal: debt,
    ...extra,
  };
}

function nightRuns(later: HistoryRow[] = []): DoneRun[] {
  return [
    {
      run: run('r-step', { item: { id: 's-rates', title: 'Compare refinance rates', level: 'step' } }),
      lines: changeLines(stepRows, [...stepRows.slice(1), ...later], names()),
      goal: debt,
    },
    {
      run: run('r-map', {
        job: 'goal',
        endedAt: '2026-09-26T01:00:00Z',
        item: { id: debt.id, title: debt.title, level: 'goal' },
      }),
      lines: changeLines(mapRows, [], names()),
      goal: debt,
    },
  ];
}

describe('doneSince', () => {
  it('lists the result with Read and each change with Undo after a night run', () => {
    const list = doneSince(SINCE, nightRuns(), new Map([['s-rates', step()]]));

    expect(list.items.map((i) => [i.kind, i.kind === 'change' ? i.sentence : i.title])).toEqual([
      ['result', 'Compare refinance rates'],
      ['change', 'Added step Call the servicer'],
      ['change', 'Added step List the loans'],
    ]);
    const result = list.items[0];
    expect(result.kind === 'result' && result.href).toBe('/goals/g-debt#step-s-rates');
    expect(result.kind === 'result' && result.unread).toBe(true);
    // The result carries the undo of the write that stored it; the run's
    // earlier start of the same step folds into it rather than getting a line.
    expect(result.kind === 'result' && result.undo).toEqual({
      runId: 'r-step',
      key: '11',
      state: 'undoable',
      reason: null,
    });
    expect(list.items.every((i) => i.kind === 'failed' || i.undo?.state === 'undoable')).toBe(true);
  });

  it('marks the result undone once its undo is written, and the step goes back as it was', () => {
    const undo = history(30, {
      actor: 'me',
      old_values: { status: 'done', result: 'Three lenders compared.' },
      new_values: { status: 'in_progress', result: null },
      undoes: 11,
    });
    const runs = nightRuns([undo]);
    const target = runs[0].lines.find((l) => l.key === '11')?.targets[0];
    expect(target).toEqual(
      expect.objectContaining({ kind: 'revert', values: { status: 'in_progress', result: null } }),
    );

    const list = doneSince(SINCE, runs, new Map([['s-rates', step({ hasResult: false })]]));
    const result = list.items[0];
    expect(result.kind).toBe('result');
    expect(result.kind === 'result' && result.undo?.state).toBe('undone');
    expect(result.kind === 'result' && result.unread).toBe(false);
  });

  it('leaves out runs from before the visit and runs still going', () => {
    const runs: DoneRun[] = [
      { run: run('old', { endedAt: '2026-09-25T20:00:00Z' }), lines: [], goal: null },
      { run: run('going', { status: 'started', endedAt: null }), lines: [], goal: null },
    ];
    expect(doneSince(SINCE, runs, new Map()).items).toEqual([]);
  });

  it('says a run failed and why', () => {
    const runs: DoneRun[] = [
      {
        run: run('r-fail', {
          status: 'failed',
          error: 'The routine refused the brief.',
          item: { id: 's-events', title: 'Find three meetups', level: 'step' },
        }),
        lines: [],
        goal: { id: 'g-city', title: 'Get plugged into the city' },
      },
    ];
    const [line] = doneSince(SINCE, runs, new Map()).items;
    expect(line).toEqual(
      expect.objectContaining({
        kind: 'failed',
        title: 'Find three meetups',
        error: 'The routine refused the brief.',
        href: '/goals/g-city#step-s-events',
      }),
    );
  });

  it('keeps an unread result from before the visit at the end', () => {
    const older = step({ id: 's-old', title: 'Summarise the loan terms', updatedAt: '2026-09-20T02:00:00Z' });
    const read = step({ id: 's-read', reviewedAt: '2026-09-21T02:00:00Z' });
    const list = doneSince(
      SINCE,
      nightRuns(),
      new Map([
        ['s-rates', step()],
        ['s-old', older],
        ['s-read', read],
      ]),
    );
    const last = list.items[list.items.length - 1];
    expect(last).toEqual(
      expect.objectContaining({ kind: 'result', id: 's-old', runId: null, undo: null, unread: true }),
    );
    expect(list.items.some((i) => i.id === 's-read')).toBe(false);
  });

  it('caps the changes and counts the rest, but never the results', () => {
    const rows = Array.from({ length: DONE_CHANGES_SHOWN + 3 }, (_, i) =>
      history(100 + i, { row_id: `s-${i}`, action: 'insert', new_values: { title: `Step ${i}` } }),
    );
    const runs: DoneRun[] = [
      ...nightRuns(),
      {
        run: run('r-big', { job: 'goal', endedAt: '2026-09-26T00:00:00Z' }),
        lines: changeLines(rows, [], emptyNames()),
        goal: debt,
      },
    ];
    const list = doneSince(SINCE, runs, new Map([['s-rates', step()]]));
    expect(list.items.filter((i) => i.kind === 'change')).toHaveLength(DONE_CHANGES_SHOWN);
    expect(list.items.filter((i) => i.kind === 'result')).toHaveLength(1);
    expect(list.more).toBe(5);
  });
});

import { describe, expect, it } from 'vitest';
import {
  checkBackWork,
  featureWork,
  judgedOnClock,
  noWorkNote,
  readsWork,
  reshapeWork,
  workedEnd,
  workWindow,
  WORK_WINDOW_MINUTES,
  type WorkRow,
} from '@/lib/plan/run-work';

const NOW = Date.parse('2026-10-03T20:00:00.000Z');
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

function row(over: Partial<WorkRow> & { id: string }): WorkRow {
  return {
    parentId: null,
    number: null,
    status: 'not_started',
    createdAt: at(10_000),
    updatedAt: at(10_000),
    completedAt: null,
    blockedAt: null,
    ...over,
  };
}

describe('which runs are read for their work', () => {
  it('reads the jobs that build no single step, and the feature batch', () => {
    expect(['notes', 'check_back', 'shape', 'reshape', 'feature'].every(readsWork)).toBe(true);
    expect(readsWork('step')).toBe(false);
    expect(readsWork(null)).toBe(false);
  });

  it('judges everything but the feature batch on the clock', () => {
    expect(judgedOnClock('reshape')).toBe(true);
    expect(judgedOnClock('notes')).toBe(true);
    expect(judgedOnClock('feature')).toBe(false);
    expect(judgedOnClock('step')).toBe(false);
  });
});

describe('workWindow', () => {
  it('stops counting six hours after the run started', () => {
    const window = workWindow(at(24 * 60), NOW);
    expect(Date.parse(window.to) - Date.parse(window.from)).toBe(WORK_WINDOW_MINUTES * 60_000);
  });

  it('stops at now for a run still inside its window', () => {
    expect(workWindow(at(30), NOW).to).toBe(new Date(NOW).toISOString());
  });
});

describe('workedEnd', () => {
  it('finishes a run the clock has called time on when its job did work', () => {
    expect(workedEnd('failed', { done: 3 })).toBe('finished');
  });

  it('fails it when its job did nothing', () => {
    expect(workedEnd('failed', { done: 0 })).toBe('failed');
  });

  it('leaves a run inside the clock alone, unless its own record says it is over', () => {
    expect(workedEnd(null, { done: 3 })).toBeNull();
    expect(workedEnd(null, { done: 1, over: true })).toBe('finished');
  });

  it('keeps a run going while its rows are still moving', () => {
    expect(workedEnd('failed', { done: 2, busy: true })).toBeNull();
  });

  it('changes nothing when no work was read', () => {
    expect(workedEnd('failed', null)).toBe('failed');
    expect(workedEnd('finished', { done: 0 })).toBe('finished');
  });
});

describe('noWorkNote', () => {
  it('adds what the job did not do to the silence', () => {
    expect(noWorkNote('notes', 'Nothing was heard from this run for 2h 5m.')).toBe(
      'Nothing was heard from this run for 2h 5m. No note was closed while it ran.',
    );
  });
});

describe('featureWork', () => {
  const window = workWindow(at(300), NOW);

  it('counts the steps beneath the feature closed or blocked while it ran', () => {
    const rows = [
      row({ id: 'f', number: 723 }),
      row({ id: 'a', parentId: 'f', status: 'done', completedAt: at(200), updatedAt: at(200) }),
      row({ id: 'b', parentId: 'a', status: 'blocked', blockedAt: at(100), updatedAt: at(100) }),
      row({ id: 'c', parentId: 'f', status: 'done', completedAt: at(400) }),
      row({ id: 'elsewhere', status: 'done', completedAt: at(50) }),
    ];
    expect(featureWork(rows, 'f', window, NOW, 20)).toEqual({ done: 2, busy: false });
  });

  it('is busy while a step beneath is claimed or something changed in the last twenty minutes', () => {
    const claimed = [row({ id: 'f' }), row({ id: 'a', parentId: 'f', status: 'in_progress' })];
    expect(featureWork(claimed, 'f', window, NOW, 20).busy).toBe(true);

    const touched = [row({ id: 'f' }), row({ id: 'a', parentId: 'f', updatedAt: at(5) })];
    expect(featureWork(touched, 'f', window, NOW, 20).busy).toBe(true);
  });

  it('is never busy once the feature itself has closed', () => {
    const rows = [row({ id: 'f', status: 'done', updatedAt: at(1) })];
    expect(featureWork(rows, 'f', window, NOW, 20).busy).toBe(false);
  });
});

describe('reshapeWork', () => {
  const window = workWindow(at(300), NOW);

  it('counts rows written or dropped beneath the feature while it ran', () => {
    const rows = [
      row({ id: 'f', number: 656 }),
      row({ id: 'new', parentId: 'f', createdAt: at(280) }),
      row({ id: 'gone', parentId: 'f', status: 'dropped', updatedAt: at(270) }),
      row({ id: 'old', parentId: 'f' }),
    ];
    expect(reshapeWork(rows, 'f', window)).toEqual({ done: 2 });
  });

  it('counts a new feature that names a closed one it came out of', () => {
    const rows = [row({ id: 'f', number: 656, status: 'done' })];
    const named = [
      { createdAt: at(250), detail: 'Came out of the re-shape of #656.' },
      { createdAt: at(250), detail: 'Came out of #6560.' },
      { createdAt: at(400), detail: 'Also from #656, but before the run.' },
    ];
    expect(reshapeWork(rows, 'f', window, named)).toEqual({ done: 1 });
  });
});

describe('checkBackWork', () => {
  it('is over once every check-back it was woken for is closed', () => {
    expect(checkBackWork(['done', 'done'])).toEqual({ done: 2, over: true });
    expect(checkBackWork(['done', 'waiting'])).toEqual({ done: 1, over: false });
    expect(checkBackWork([])).toEqual({ done: 0, over: false });
  });
});

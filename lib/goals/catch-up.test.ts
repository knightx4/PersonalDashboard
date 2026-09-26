import { describe, expect, it } from 'vitest';
import {
  AWAY_DAYS,
  SITTING_MINUTES,
  catchUp,
  catchUpSince,
  nextVisit,
  type VisitRecord,
} from './catch-up';
import type { DailyGoal } from './daily';

const at = (iso: string) => new Date(iso);

describe('nextVisit and catchUpSince', () => {
  it('shows nothing on a first visit', () => {
    const record = nextVisit(null, at('2026-09-25T09:00:00Z'), '2026-09-25');
    expect(record).toEqual({
      lastVisitAt: '2026-09-25T09:00:00.000Z',
      awayFrom: null,
      backOn: null,
      previousVisitAt: null,
    });
    expect(catchUpSince(record, '2026-09-25')).toBeNull();
  });

  it('leads with the catch-up after a week away, all that day, and not the next', () => {
    const before: VisitRecord = {
      lastVisitAt: '2026-09-18T08:00:00.000Z',
      awayFrom: null,
      backOn: null,
      previousVisitAt: null,
    };
    const back = nextVisit(before, at('2026-09-25T09:00:00Z'), '2026-09-25');
    expect(catchUpSince(back, '2026-09-25')).toBe('2026-09-18T08:00:00.000Z');

    // Into a goal and back to the home, the same day.
    const again = nextVisit(back, at('2026-09-25T09:20:00Z'), '2026-09-25');
    expect(catchUpSince(again, '2026-09-25')).toBe('2026-09-18T08:00:00.000Z');

    const nextDay = nextVisit(again, at('2026-09-26T09:00:00Z'), '2026-09-26');
    expect(catchUpSince(nextDay, '2026-09-26')).toBeNull();
  });

  it('counts a gap of just under the threshold as an ordinary visit', () => {
    const before: VisitRecord = {
      lastVisitAt: '2026-09-20T09:00:01.000Z',
      awayFrom: null,
      backOn: null,
      previousVisitAt: null,
    };
    const record = nextVisit(before, at(`2026-09-25T09:00:00Z`), '2026-09-25');
    expect(AWAY_DAYS).toBe(5);
    expect(catchUpSince(record, '2026-09-25')).toBeNull();
  });
});

describe('nextVisit sittings (plan #1010)', () => {
  const evening: VisitRecord = {
    lastVisitAt: '2026-09-24T21:00:00.000Z',
    awayFrom: null,
    backOn: null,
    previousVisitAt: '2026-09-24T08:00:00.000Z',
  };

  it('starts a sitting in the morning from the evening visit, and keeps it through reloads', () => {
    const morning = nextVisit(evening, at('2026-09-25T07:00:00Z'), '2026-09-25');
    expect(morning.previousVisitAt).toBe('2026-09-24T21:00:00.000Z');

    // A press on the home reloads it ten minutes later: still the same sitting.
    const reload = nextVisit(morning, at('2026-09-25T07:10:00Z'), '2026-09-25');
    expect(reload.previousVisitAt).toBe('2026-09-24T21:00:00.000Z');
  });

  it('clears the list at the next sitting', () => {
    const morning = nextVisit(evening, at('2026-09-25T07:00:00Z'), '2026-09-25');
    const later = nextVisit(morning, at(`2026-09-25T07:${SITTING_MINUTES}:00Z`), '2026-09-25');
    expect(later.previousVisitAt).toBe('2026-09-25T07:00:00.000Z');
  });
});

function daily(id: string, next: string[]): DailyGoal {
  return {
    goal: {
      id,
      areaId: 'area',
      title: `Goal ${id}`,
      acceptance: null,
      fog: null,
      status: 'open',
      position: 10,
      unit: null,
      target: null,
    },
    areaName: 'Money',
    next: next.map((title) => ({ id: title, title, kind: 'mine', dueOn: null, under: null })),
    more: 0,
    hasSteps: next.length > 0,
  };
}

describe('catchUp', () => {
  const since = '2026-09-18T08:00:00Z';

  it('takes one next step per goal and skips a goal with none', () => {
    const result = catchUp(since, {
      goals: [daily('g1', ['First', 'Second']), daily('g2', []), daily('g3', ['Only'])],
      waiting: [],
    });
    expect(result.next.map((n) => [n.goalId, n.item.title])).toEqual([
      ['g1', 'First'],
      ['g3', 'Only'],
    ]);
  });
});

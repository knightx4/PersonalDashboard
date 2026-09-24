import { describe, expect, it } from 'vitest';
import {
  MAX_BACKFILL,
  atRiskRhythms,
  isAtRisk,
  liveRhythms,
  periodOf,
  progressLine,
  recordsOf,
  syncPlan,
  type LiveRhythm,
  type PeriodRow,
} from './rhythms';
import { buildForest, type Step } from './steps';
import type { Goal } from './tree';

// 2026-09-21 is a Monday.
const MON = '2026-09-21';

function rhythm(extra: Partial<LiveRhythm> = {}): LiveRhythm {
  return {
    id: 'r',
    title: 'One city event',
    target: 1,
    period: 'week',
    goalId: 'g',
    goalTitle: 'City life',
    ...extra,
  };
}

function row(extra: Partial<PeriodRow> = {}): PeriodRow {
  return {
    id: 'p',
    itemId: 'r',
    startsOn: MON,
    endsOn: '2026-09-28',
    target: 1,
    count: 0,
    kept: null,
    closedAt: null,
    ...extra,
  };
}

describe('periodOf', () => {
  it('runs a week from Monday to the next Monday', () => {
    expect(periodOf('week', '2026-09-24')).toEqual({ startsOn: MON, endsOn: '2026-09-28' });
    expect(periodOf('week', '2026-09-27')).toEqual({ startsOn: MON, endsOn: '2026-09-28' });
    expect(periodOf('week', MON)).toEqual({ startsOn: MON, endsOn: '2026-09-28' });
  });

  it('runs a day to the next day and a month to the next first', () => {
    expect(periodOf('day', '2026-09-24')).toEqual({
      startsOn: '2026-09-24',
      endsOn: '2026-09-25',
    });
    expect(periodOf('month', '2026-12-15')).toEqual({
      startsOn: '2026-12-01',
      endsOn: '2027-01-01',
    });
  });
});

describe('syncPlan', () => {
  it('opens the current period for a rhythm with none', () => {
    const plan = syncPlan([rhythm()], [], '2026-09-24');
    expect(plan.close).toEqual([]);
    expect(plan.insert).toEqual([
      { itemId: 'r', startsOn: MON, endsOn: '2026-09-28', target: 1, kept: null },
    ]);
  });

  it('writes nothing when the current period is already open', () => {
    const plan = syncPlan([rhythm()], [row()], '2026-09-24');
    expect(plan).toEqual({ close: [], reshape: [], insert: [] });
  });

  it('closes an ended period as kept or missed on its count and opens the next', () => {
    const kept = syncPlan(
      [rhythm()],
      [row({ id: 'old', startsOn: '2026-09-14', endsOn: MON, count: 1 })],
      '2026-09-22',
    );
    expect(kept.close).toEqual([{ id: 'old', kept: true }]);
    expect(kept.insert.map((r) => r.startsOn)).toEqual([MON]);

    const missed = syncPlan(
      [rhythm({ target: 3 })],
      [row({ id: 'old', startsOn: '2026-09-14', endsOn: MON, count: 2, target: 3 })],
      '2026-09-22',
    );
    expect(missed.close).toEqual([{ id: 'old', kept: false }]);
  });

  it('writes the weeks nobody opened the app in as missed', () => {
    const plan = syncPlan(
      [rhythm()],
      [row({ id: 'old', startsOn: '2026-08-31', endsOn: '2026-09-07', count: 1 })],
      '2026-09-24',
    );
    expect(plan.close).toEqual([{ id: 'old', kept: true }]);
    expect(plan.insert).toEqual([
      { itemId: 'r', startsOn: '2026-09-07', endsOn: '2026-09-14', target: 1, kept: false },
      { itemId: 'r', startsOn: '2026-09-14', endsOn: MON, target: 1, kept: false },
      { itemId: 'r', startsOn: MON, endsOn: '2026-09-28', target: 1, kept: null },
    ]);
  });

  it('caps how many missed periods it writes', () => {
    const plan = syncPlan(
      [rhythm({ period: 'day' })],
      [
        row({
          startsOn: '2025-01-01',
          endsOn: '2025-01-02',
          kept: true,
          closedAt: '2025-01-02T00:00:00Z',
        }),
      ],
      '2026-09-24',
    );
    const missed = plan.insert.filter((r) => r.kept === false);
    expect(missed).toHaveLength(MAX_BACKFILL);
    expect(missed.at(-1)?.startsOn).toBe('2026-09-23');
  });

  it('gives the current period a changed target or period length', () => {
    const plan = syncPlan([rhythm({ target: 2 })], [row()], '2026-09-24');
    expect(plan.reshape).toEqual([{ id: 'p', target: 2, endsOn: '2026-09-28' }]);

    // Weekly made daily on the Monday: one row per start day, so it is reshaped.
    const daily = syncPlan([rhythm({ period: 'day' })], [row()], MON);
    expect(daily.reshape).toEqual([{ id: 'p', target: 1, endsOn: '2026-09-22' }]);
    expect(daily.insert).toEqual([]);
  });

  it('closes an open period that no longer matches and opens the right one', () => {
    const plan = syncPlan([rhythm({ period: 'day' })], [row({ count: 1 })], '2026-09-24');
    expect(plan.close).toEqual([{ id: 'p', kept: true }]);
    expect(plan.insert).toEqual([
      { itemId: 'r', startsOn: '2026-09-24', endsOn: '2026-09-25', target: 1, kept: null },
    ]);
  });

  it('leaves rhythms that are not live alone', () => {
    expect(syncPlan([], [row({ startsOn: '2026-01-05', endsOn: '2026-01-12' })], MON)).toEqual({
      close: [],
      reshape: [],
      insert: [],
    });
  });
});

describe('isAtRisk', () => {
  it('puts a weekly rhythm of one at risk from Friday while unmet', () => {
    const r = row();
    expect(isAtRisk('week', r, '2026-09-24')).toBe(false); // Thursday
    expect(isAtRisk('week', r, '2026-09-25')).toBe(true); // Friday
    expect(isAtRisk('week', r, '2026-09-27')).toBe(true); // Sunday
    expect(isAtRisk('week', { ...r, count: 1 }, '2026-09-27')).toBe(false);
  });

  it('puts a rhythm needing more at risk earlier', () => {
    const r = row({ target: 3, count: 0 });
    expect(isAtRisk('week', r, '2026-09-22')).toBe(false); // Tuesday, 6 days left
    expect(isAtRisk('week', r, '2026-09-23')).toBe(true); // Wednesday, 5 left
  });
});

describe('recordsOf and atRiskRhythms', () => {
  it('splits the open current period from the closed ones, oldest first', () => {
    const rows = [
      row({ id: 'now' }),
      row({ id: 'b', startsOn: '2026-09-14', endsOn: MON, kept: false, closedAt: 'x' }),
      row({ id: 'a', startsOn: '2026-09-07', endsOn: '2026-09-14', kept: true, closedAt: 'x' }),
    ];
    const record = recordsOf(rows, '2026-09-25').get('r');
    expect(record?.current?.id).toBe('now');
    expect(record?.past.map((p) => p.id)).toEqual(['a', 'b']);

    const risk = atRiskRhythms([rhythm()], recordsOf(rows, '2026-09-25'), '2026-09-25');
    expect(risk).toEqual([{ ...rhythm(), count: 0, daysLeft: 3 }]);
    expect(progressLine('week', risk[0])).toBe('0 of 1 this week');
  });
});

describe('liveRhythms', () => {
  const goal = (id: string, status: Goal['status'] = 'open'): Goal => ({
    id,
    areaId: 'a',
    title: id,
    acceptance: null,
    fog: null,
    status,
    position: 10,
    unit: null,
    target: null,
  });
  const step = (id: string, parentId: string, extra: Partial<Step> = {}): Step => ({
    id,
    parentId,
    kind: 'rhythm',
    status: 'open',
    title: id,
    detail: null,
    acceptance: null,
    resolution: null,
    dueOn: null,
    position: 10,
    rhythmCount: 1,
    rhythmPeriod: 'week',
    onTodo: false,
    ...extra,
  });

  it('keeps open rhythms reachable through open steps of open goals', () => {
    const goals = [goal('g'), goal('p', 'proposed')];
    const { byGoal } = buildForest(
      goals.map((g) => g.id),
      [
        step('live', 'g'),
        step('branch', 'g', { kind: 'mine', rhythmCount: null, rhythmPeriod: null }),
        step('under', 'branch'),
        step('dropped', 'g', { status: 'dropped' }),
        step('pending', 'p'),
      ],
    );
    expect(liveRhythms(goals, byGoal).map((r) => r.id)).toEqual(['live', 'under']);
  });
});

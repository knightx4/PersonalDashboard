import { describe, expect, it } from 'vitest';
import {
  MAX_BACKFILL,
  homeRhythms,
  isAtRisk,
  liveRhythms,
  missedLine,
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

describe('recordsOf and homeRhythms', () => {
  it('splits the open current period from the closed ones, oldest first', () => {
    const rows = [
      row({ id: 'now' }),
      row({ id: 'b', startsOn: '2026-09-14', endsOn: MON, kept: false, closedAt: 'x' }),
      row({ id: 'a', startsOn: '2026-09-07', endsOn: '2026-09-14', kept: true, closedAt: 'x' }),
    ];
    const record = recordsOf(rows, '2026-09-25').get('r');
    expect(record?.current?.id).toBe('now');
    expect(record?.past.map((p) => p.id)).toEqual(['a', 'b']);
    expect(record?.missed).toBe(1);

    const shown = homeRhythms([rhythm()], recordsOf(rows, '2026-09-25'), '2026-09-25');
    expect(shown).toEqual([{ ...rhythm(), count: 0, daysLeft: 3, atRisk: true, missed: 1 }]);
    expect(progressLine('week', shown[0])).toBe('0 of 1 this week');
  });

  it('counts the whole run of misses, not only the periods kept for display', () => {
    const rows = [row({ id: 'now', startsOn: '2026-09-25', endsOn: '2026-09-26' })];
    for (let day = 1; day <= 20; day++) {
      const startsOn = `2026-09-${String(day + 4).padStart(2, '0')}`;
      const endsOn = `2026-09-${String(day + 5).padStart(2, '0')}`;
      rows.push(row({ id: `d${day}`, startsOn, endsOn, kept: day === 1, closedAt: 'x' }));
    }
    const record = recordsOf(rows, '2026-09-25').get('r');
    expect(record?.past).toHaveLength(8);
    expect(record?.missed).toBe(19);
  });
});

describe('coming back after time away', () => {
  /** Carry out a sync plan on the rows, as rhythms-store does. */
  function applyPlan(rows: PeriodRow[], today: string, live: LiveRhythm[]): PeriodRow[] {
    const plan = syncPlan(live, rows, today);
    const out = rows.map((r) => {
      const close = plan.close.find((c) => c.id === r.id);
      return close ? { ...r, kept: close.kept, closedAt: 'x' } : r;
    });
    plan.insert.forEach((r, i) =>
      out.push({
        id: `new${i}`,
        itemId: r.itemId,
        startsOn: r.startsOn,
        endsOn: r.endsOn,
        target: r.target,
        count: 0,
        kept: r.kept,
        closedAt: r.kept === null ? null : 'x',
      }),
    );
    return out;
  }

  it('folds a two-week gap into one line per rhythm', () => {
    // Last opened in the week of 7 September, then nothing until Tuesday the 22nd.
    const live = [rhythm(), rhythm({ id: 'r2', title: 'Call a friend', target: 2 })];
    const rows = [
      row({ id: 'old1', startsOn: '2026-09-07', endsOn: '2026-09-14' }),
      row({ id: 'old2', itemId: 'r2', startsOn: '2026-09-07', endsOn: '2026-09-14', target: 2 }),
    ];
    const today = '2026-09-22';
    const after = applyPlan(rows, today, live);

    // Each missed week is still stored, so the history records every one.
    expect(after.filter((r) => r.kept === false)).toHaveLength(4);

    const shown = homeRhythms(live, recordsOf(after, today), today);
    expect(shown.map((r) => [r.id, r.missed, r.atRisk])).toEqual([
      ['r', 2, false],
      ['r2', 2, false],
    ]);
    expect(missedLine('week', shown[0].missed)).toBe('2 weeks missed');
  });

  it('stops showing the misses once this period is met', () => {
    const rows = [
      row({ id: 'now', count: 1 }),
      row({ id: 'b', startsOn: '2026-09-14', endsOn: MON, kept: false, closedAt: 'x' }),
    ];
    expect(homeRhythms([rhythm()], recordsOf(rows, '2026-09-22'), '2026-09-22')).toEqual([]);
  });

  it('names the period in the missed line', () => {
    expect(missedLine('day', 1)).toBe('1 day missed');
    expect(missedLine('month', 3)).toBe('3 months missed');
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
    result: null,
    resultUrl: null,
    reviewedAt: null,
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

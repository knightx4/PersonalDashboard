/**
 * What the morning says about the night.
 *
 * The properties that matter are the ones a person would catch the report
 * lying about: the window is the night rather than the day, the reason it
 * stopped is the sentence the row carries and not a rewording of it, a night
 * still going at noon is not described as over, and a night already reported
 * is not reported again every morning afterwards.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_NIGHT_ROWS,
  nightBudgetLine,
  nightClosedLine,
  nightFrom,
  nightLine,
  nightRows,
} from '@/lib/digest/night';
import type { PlanItem } from '@/lib/plan/load';
import {
  budgetSpentReason,
  OVERNIGHT_STOPPED_BY_HAND,
  type OvernightRun,
} from '@/lib/plan/overnight';

const SINCE = '2026-03-01T12:00:00Z';
const STARTED = '2026-03-01T23:00:00Z';

let counter = 0;

function step(over: Partial<PlanItem> & { id: string }): PlanItem {
  counter += 1;
  return {
    number: counter,
    module: 'dev',
    parentId: null,
    title: `Step ${over.id}`,
    detail: null,
    acceptance: null,
    status: 'done',
    kind: 'build',
    fog: null,
    fogDismissedAt: null,
    dismissedAt: null,
    resolution: null,
    thread: [],
    comment: null,
    blockAsk: null,
    blockKind: null,
    priority: 2,
    size: null,
    assignee: null,
    commitSha: null,
    position: counter * 10,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function run(over: Partial<OvernightRun> = {}): OvernightRun {
  return {
    id: 'run-1',
    running: false,
    paused: false,
    featuresBudget: 6,
    featuresLeft: 4,
    stopBy: '2026-03-02T07:00:00Z',
    startedAt: STARTED,
    lastFiredAt: '2026-03-02T02:00:00Z',
    endedAt: '2026-03-02T03:00:00Z',
    endedReason: budgetSpentReason({ featuresBudget: 6 }),
    createdAt: STARTED,
    updatedAt: '2026-03-02T03:00:00Z',
    ...over,
  };
}

describe('nightFrom', () => {
  it('says nothing about an account that has never started a night', () => {
    expect(nightFrom({ run: null, fires: [], items: [], since: SINCE })).toBeNull();
    expect(
      nightFrom({
        run: run({ running: false, endedAt: null, endedReason: null }),
        fires: [],
        items: [],
        since: SINCE,
      }),
    ).toBeNull();
  });

  it('does not report the same night again the next morning', () => {
    const old = run({ startedAt: '2026-02-20T23:00:00Z', endedAt: '2026-02-21T03:00:00Z' });
    expect(nightFrom({ run: old, fires: [], items: [], since: SINCE })).toBeNull();
  });

  it('names the features it fired, once each and in the order it fired them', () => {
    const first = step({ id: 'f1', title: 'One tab for your day' });
    const second = step({ id: 'f2', title: 'Say what happened overnight' });

    const night = nightFrom({
      run: run(),
      fires: [
        // Newest first, the way the rows come back.
        { planItemId: 'f2', at: '2026-03-02T02:00:00Z' },
        { planItemId: 'f1', at: '2026-03-02T01:00:00Z' },
        { planItemId: 'f1', at: '2026-03-02T00:10:00Z' },
        // Before the button was pressed: a different night, or your own press.
        { planItemId: 'f1', at: '2026-03-01T18:00:00Z' },
        // A run that named no step, and one naming a step this deploy has lost.
        { planItemId: null, at: '2026-03-02T00:05:00Z' },
        { planItemId: 'gone', at: '2026-03-02T00:06:00Z' },
      ],
      items: [first, second],
      since: SINCE,
    });

    expect(night?.features.map((feature) => feature.title)).toEqual([
      'One tab for your day',
      'Say what happened overnight',
    ]);
  });

  it('names the feature it is on now, not the first one it reached', () => {
    const first = step({ id: 'f1', title: 'One tab for your day' });
    const second = step({ id: 'f2', title: 'Say what happened overnight' });

    const night = nightFrom({
      run: run({ running: true, endedAt: null, endedReason: null }),
      fires: [
        // It came back to the feature it started on, which is the case the
        // deduplicated list gets wrong: `features` still leads with #f1.
        { planItemId: 'f1', at: '2026-03-02T02:30:00Z' },
        { planItemId: 'f2', at: '2026-03-02T01:00:00Z' },
        { planItemId: 'f1', at: '2026-03-02T00:10:00Z' },
      ],
      items: [first, second],
      since: SINCE,
    });

    expect(night?.features.at(-1)?.title).toBe('Say what happened overnight');
    expect(night?.lastFire).toEqual({
      ref: `#${first.number}`,
      title: 'One tab for your day',
      at: '2026-03-02T02:30:00Z',
    });
  });

  it('has no feature to name on a night that has fired nothing', () => {
    const night = nightFrom({
      run: run({ running: true, endedAt: null, endedReason: null, lastFiredAt: null }),
      fires: [
        // Both outside the night: one before the button, one naming a step
        // this deploy no longer has.
        { planItemId: 'f1', at: '2026-03-01T18:00:00Z' },
        { planItemId: 'gone', at: '2026-03-02T01:00:00Z' },
      ],
      items: [step({ id: 'f1', title: 'One tab for your day' })],
      since: SINCE,
    });

    expect(night?.features).toEqual([]);
    expect(night?.lastFire).toBeNull();
  });

  it('names what closed inside the night and nothing closed before it', () => {
    const feature = step({ id: 'f1', title: 'One tab for your day', completedAt: null });
    const closed = step({
      id: 's1',
      parentId: 'f1',
      title: 'Store what the runner is doing',
      completedAt: '2026-03-02T01:30:00Z',
    });
    const earlier = step({ id: 's2', title: 'Yesterday', completedAt: '2026-03-01T14:00:00Z' });
    const answered = step({
      id: 'd1',
      kind: 'decision',
      title: 'Which shape?',
      completedAt: '2026-03-02T01:40:00Z',
    });

    const night = nightFrom({
      run: run(),
      fires: [{ planItemId: 'f1', at: '2026-03-02T01:00:00Z' }],
      items: [feature, closed, earlier, answered],
      since: SINCE,
    });

    expect(night?.closed).toEqual([
      {
        ref: `#${closed.number}`,
        title: 'Store what the runner is doing',
        feature: { ref: `#${feature.number}`, title: 'One tab for your day' },
        ask: null,
      },
    ]);
  });

  it('names what it left blocked, with what that step needs', () => {
    const blocked = step({
      id: 's1',
      status: 'blocked',
      title: 'Fire one feature each tick',
      blockAsk: 'Needs the plan routine token on the deployment.',
      completedAt: null,
      updatedAt: '2026-03-02T02:20:00Z',
    });
    const blockedBefore = step({
      id: 's2',
      status: 'blocked',
      title: 'Stopped last week',
      completedAt: null,
      updatedAt: '2026-02-24T09:00:00Z',
    });

    const night = nightFrom({
      run: run(),
      fires: [],
      items: [blocked, blockedBefore],
      since: SINCE,
    });

    expect(night?.blocked).toEqual([
      {
        ref: `#${blocked.number}`,
        title: 'Fire one feature each tick',
        feature: null,
        ask: 'Needs the plan routine token on the deployment.',
      },
    ]);
  });

  it('carries the reason it stopped word for word', () => {
    const byHand = nightFrom({
      run: run({ endedReason: OVERNIGHT_STOPPED_BY_HAND }),
      fires: [],
      items: [],
      since: SINCE,
    });

    expect(byHand?.standing).toBe('stopped');
    expect(byHand?.endedReason).toBe(OVERNIGHT_STOPPED_BY_HAND);
    expect(nightLine(byHand!)).toBe(OVERNIGHT_STOPPED_BY_HAND);
  });

  it('does not pretend a night still going at noon is over', () => {
    const night = nightFrom({
      run: run({ running: true, endedAt: null, endedReason: null }),
      fires: [],
      items: [],
      since: SINCE,
    });

    expect(night?.standing).toBe('running');
    expect(night?.endedReason).toBeNull();
    expect(nightLine(night!)).toContain('still running');
  });

  it('reads a held night as held rather than as stopped', () => {
    const night = nightFrom({
      run: run({ running: true, paused: true, endedAt: null, endedReason: null }),
      fires: [],
      items: [],
      since: SINCE,
    });

    expect(night?.standing).toBe('paused');
    expect(nightLine(night!)).toContain('held');
  });
});

describe('nightRows', () => {
  // The record keeps every row; the page is what cuts them. A night that
  // closed thirty steps must still be able to say so.
  it('cuts the list for the page and counts what it cut', () => {
    const rows = Array.from({ length: MAX_NIGHT_ROWS + 7 }, (_, index) => index);

    expect(nightRows(rows).shown).toHaveLength(MAX_NIGHT_ROWS);
    expect(nightRows(rows).more).toBe(7);
    expect(nightRows([1, 2]).more).toBe(0);
  });
});

describe('nightBudgetLine', () => {
  // Since #633 the plan page's control prints this same line rather than
  // counting the pair the other way round, so these are the words on both.
  it('says what the night spent, in the control’s words', () => {
    expect(nightBudgetLine({ featuresBudget: 6, featuresLeft: 4 })).toBe('2 of 6 features spent');
    expect(nightBudgetLine({ featuresBudget: 1, featuresLeft: 0 })).toBe('1 of 1 feature spent');
    expect(nightBudgetLine({ featuresBudget: 6, featuresLeft: 6 })).toBe('0 of 6 features spent');
  });
});

describe('nightClosedLine', () => {
  // The other half of the totals. A night that closed nothing says so in
  // words, because a zero beside a budget is the easiest thing on the card to
  // read past -- and it is the outcome worth getting out of bed for.
  it('counts the steps, and says when there are none', () => {
    expect(nightClosedLine({ closed: [] })).toBe('no steps closed');
    expect(nightClosedLine({ closed: [{ ref: '#1', title: 'One', feature: null, ask: null }] })).toBe(
      '1 step closed',
    );
    expect(
      nightClosedLine({
        closed: Array.from({ length: 9 }, (_, index) => ({
          ref: `#${index}`,
          title: 'A step',
          feature: null,
          ask: null,
        })),
      }),
    ).toBe('9 steps closed');
  });
});

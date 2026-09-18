import { describe, expect, it, vi } from 'vitest';
import {
  budgetSpentReason,
  loadOvernightRun,
  overnightLine,
  overnightRunFromRow,
  overnightStanding,
  overnightStopBy,
  overnightVerdict,
  OVERNIGHT_HOUR_CAP,
  OVERNIGHT_STOPPED_BY_HAND,
  OVERNIGHT_TIME_UP,
  pauseOvernightRun,
  recordOvernightFire,
  resumeOvernightRun,
  startOvernightRun,
  stopOvernightRun,
  type OvernightRun,
} from '@/lib/plan/overnight';

const MIDNIGHT = Date.parse('2026-09-17T23:00:00.000Z');
const SEVEN_AM = '2026-09-18T07:00:00.000Z';

/** A night that is on, with everything the tick reads set to something sane. */
function night(over: Partial<OvernightRun> = {}): OvernightRun {
  return {
    id: 'run-1',
    running: true,
    paused: false,
    featuresBudget: 6,
    featuresLeft: 6,
    stopBy: SEVEN_AM,
    startedAt: '2026-09-17T23:00:00.000Z',
    lastFiredAt: null,
    endedAt: null,
    endedReason: null,
    createdAt: '2026-09-17T23:00:00.000Z',
    updatedAt: '2026-09-17T23:00:00.000Z',
    ...over,
  };
}

/**
 * A Supabase stub that records the chain and hands back one row.
 *
 * Every write here is `update`/`upsert` then filters then `select` then
 * `maybeSingle`, so one recording object stands in for all of them and the
 * assertions can read what was written and what it was written to.
 */
function db(row: Record<string, unknown> | null = null, error: { message: string } | null = null) {
  const filters: Array<[string, unknown]> = [];
  const calls: { update?: unknown; upsert?: unknown; options?: unknown; select?: string } = {};
  const chain = {
    update: (patch: unknown) => {
      calls.update = patch;
      return chain;
    },
    upsert: (patch: unknown, options?: unknown) => {
      calls.upsert = patch;
      calls.options = options;
      return chain;
    },
    select: (columns: string) => {
      calls.select = columns;
      return chain;
    },
    eq: (column: string, value: unknown) => {
      filters.push([column, value]);
      return chain;
    },
    maybeSingle: async () => ({ data: row, error }),
  };
  const from = vi.fn(() => chain);
  return { supabase: { from }, from, filters, calls };
}

describe('overnightVerdict', () => {
  it('fires when the night is on, unpaused and inside both brakes', () => {
    expect(overnightVerdict(night(), MIDNIGHT)).toEqual({ act: 'fire' });
  });

  it('is idle when there is no row at all, and when the runner is off', () => {
    expect(overnightVerdict(null, MIDNIGHT)).toEqual({ act: 'idle' });
    expect(overnightVerdict(night({ running: false }), MIDNIGHT)).toEqual({ act: 'idle' });
  });

  it('holds a paused night without writing an end on it', () => {
    expect(overnightVerdict(night({ paused: true }), MIDNIGHT)).toEqual({ act: 'paused' });
  });

  it('ends a night whose budget is gone, saying how many that was', () => {
    expect(overnightVerdict(night({ featuresLeft: 0 }), MIDNIGHT)).toEqual({
      act: 'end',
      reason: 'It fired every one of the 6 features you allowed.',
    });
  });

  it('ends a night that reached the time it was told to stop by', () => {
    const now = Date.parse('2026-09-18T07:00:00.000Z');
    expect(overnightVerdict(night(), now)).toEqual({ act: 'end', reason: OVERNIGHT_TIME_UP });
  });

  // A paused night past its stop time is over, not held: left paused it would
  // sit there all morning with no reason written and nothing to report back.
  it('ends a paused night that ran out of clock', () => {
    const now = Date.parse('2026-09-18T07:30:00.000Z');
    expect(overnightVerdict(night({ paused: true }), now)).toEqual({
      act: 'end',
      reason: OVERNIGHT_TIME_UP,
    });
  });

  // Both brakes gone at once: the budget is the honest answer, because the
  // hour the clock happened to be checked is not what ended the night.
  it('blames the budget when the budget and the clock have both gone', () => {
    const now = Date.parse('2026-09-18T07:30:00.000Z');
    expect(overnightVerdict(night({ featuresLeft: 0 }), now)).toEqual({
      act: 'end',
      reason: budgetSpentReason(night()),
    });
  });

  it('fires on a night with no stop time rather than treating it as expired', () => {
    expect(overnightVerdict(night({ stopBy: null }), MIDNIGHT)).toEqual({ act: 'fire' });
  });
});

describe('budgetSpentReason', () => {
  it('reads as a sentence, in the singular when one feature was allowed', () => {
    expect(budgetSpentReason({ featuresBudget: 1 })).toBe('It fired the one feature you allowed.');
    expect(budgetSpentReason({ featuresBudget: 4 })).toBe(
      'It fired every one of the 4 features you allowed.',
    );
  });
});

describe('what the control reads off the row', () => {
  it('has a standing for each of the four things the row can be', () => {
    expect(overnightStanding(null)).toBe('off');
    expect(overnightStanding(night())).toBe('running');
    expect(overnightStanding(night({ paused: true }))).toBe('paused');
    expect(
      overnightStanding(night({ running: false, paused: false, endedReason: OVERNIGHT_TIME_UP })),
    ).toBe('stopped');
  });

  // A row that has never run carries no reason, and "Stopped" with nothing
  // after it would be the page claiming something happened that did not.
  it('calls a row that has never run off rather than stopped', () => {
    expect(overnightStanding(night({ running: false, endedReason: null }))).toBe('off');
  });

  // The five reasons are written as whole sentences so that everything reading
  // them back says the same words. This is that promise, pinned.
  it('prints a stopped night reason verbatim', () => {
    const run = night({ running: false, endedReason: OVERNIGHT_STOPPED_BY_HAND });
    expect(overnightLine(run, MIDNIGHT)).toBe(OVERNIGHT_STOPPED_BY_HAND);
    expect(overnightLine(night({ running: false, endedReason: OVERNIGHT_TIME_UP }), MIDNIGHT)).toBe(
      OVERNIGHT_TIME_UP,
    );
  });

  it('says a held night finishes what it started and fires nothing after it', () => {
    expect(overnightLine(night({ paused: true }), MIDNIGHT)).toContain('finishes and commits');
  });

  // #581: the row cannot tell a tick waiting on a live session from a cron
  // that has stopped running, so the line gives the elapsed time and claims
  // neither.
  it('dates the last fire rather than claiming the runner is waiting', () => {
    const run = night({ lastFiredAt: '2026-09-17T22:20:00.000Z' });
    expect(overnightLine(run, MIDNIGHT)).toBe(
      'It last fired a feature 40m ago. The next one goes once that session has ended.',
    );
  });

  it('says nothing has been fired on a night that has not fired anything', () => {
    expect(overnightLine(night(), MIDNIGHT)).toBe(
      'Nothing has been fired yet. The next tick picks the first feature.',
    );
  });

  // The clock's pre-mount value. Same sentence, no figure, so the line does not
  // change shape under the reader on hydration.
  it('drops the elapsed time before the browser clock arrives', () => {
    expect(overnightLine(night({ lastFiredAt: '2026-09-17T22:20:00.000Z' }), 0)).toBe(
      'A feature is already under way. The next one goes once that session has ended.',
    );
  });
});

describe('overnightStopBy', () => {
  it('turns a number of hours into the instant the night stops', () => {
    expect(overnightStopBy(8, MIDNIGHT)).toBe('2026-09-18T07:00:00.000Z');
  });

  // Both brakes or no press: whatever the form sent, what comes out of here is
  // a stop time the check constraint will take.
  it('clamps a length no form should have been able to send', () => {
    expect(overnightStopBy(0, MIDNIGHT)).toBe('2026-09-18T00:00:00.000Z');
    expect(overnightStopBy(-4, MIDNIGHT)).toBe('2026-09-18T00:00:00.000Z');
    expect(overnightStopBy(1000, MIDNIGHT)).toBe(
      new Date(MIDNIGHT + OVERNIGHT_HOUR_CAP * 60 * 60 * 1000).toISOString(),
    );
    expect(overnightStopBy(Number.NaN, MIDNIGHT)).toBe('2026-09-18T00:00:00.000Z');
  });
});

describe('overnightRunFromRow', () => {
  it('reads a row back, whichever shape the timestamps arrive in', () => {
    const run = overnightRunFromRow({
      id: 'run-1',
      running: true,
      paused: false,
      features_budget: 6,
      features_left: 4,
      stop_by: new Date(SEVEN_AM),
      started_at: '2026-09-17T23:00:00.000Z',
      last_fired_at: null,
      ended_at: null,
      ended_reason: null,
      created_at: '2026-09-17T23:00:00.000Z',
      updated_at: '2026-09-17T23:05:00.000Z',
    });

    expect(run.stopBy).toBe(SEVEN_AM);
    expect(run.featuresLeft).toBe(4);
    expect(run.lastFiredAt).toBeNull();
    expect(run.endedReason).toBeNull();
  });

  it('reads a fresh account back as off rather than as half on', () => {
    const run = overnightRunFromRow({
      id: 'run-1',
      running: false,
      paused: false,
      features_budget: 0,
      features_left: 0,
      stop_by: null,
      started_at: null,
      last_fired_at: null,
      ended_at: null,
      ended_reason: null,
      created_at: '2026-09-17T23:00:00.000Z',
      updated_at: null,
    });

    expect(run.running).toBe(false);
    expect(run.featuresBudget).toBe(0);
    // Never updated, so it reads as its own creation rather than as empty.
    expect(run.updatedAt).toBe('2026-09-17T23:00:00.000Z');
  });
});

describe('loadOvernightRun', () => {
  it('reads the account row, and answers null when there is none', async () => {
    const empty = db(null);
    await expect(loadOvernightRun(empty.supabase as never, 'user-1')).resolves.toBeNull();
    expect(empty.from).toHaveBeenCalledWith('plan_overnight_runs');
    expect(empty.filters).toEqual([['user_id', 'user-1']]);
  });

  it('swallows a read failure rather than taking the page down with it', async () => {
    const broken = db(null, { message: 'nope' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(loadOvernightRun(broken.supabase as never, 'user-1')).resolves.toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('starting a night', () => {
  it('writes the budget, the stop time and a clean slate, on the account row', async () => {
    const stub = db({ id: 'run-1', running: true, features_budget: 6, features_left: 6 });
    await startOvernightRun({
      supabase: stub.supabase as never,
      userId: 'user-1',
      features: 6,
      stopBy: SEVEN_AM,
      now: new Date(MIDNIGHT),
    });

    expect(stub.calls.upsert).toEqual({
      user_id: 'user-1',
      running: true,
      paused: false,
      features_budget: 6,
      features_left: 6,
      stop_by: SEVEN_AM,
      started_at: new Date(MIDNIGHT).toISOString(),
      last_fired_at: null,
      ended_at: null,
      ended_reason: null,
    });
    // One row per account, so a second night is the same row written again.
    expect(stub.calls.options).toEqual({ onConflict: 'user_id' });
  });

  it('clamps a silly budget instead of letting the check constraint refuse it', async () => {
    const stub = db({ id: 'run-1' });
    await startOvernightRun({
      supabase: stub.supabase as never,
      userId: 'user-1',
      features: 1000.7,
      stopBy: new Date(SEVEN_AM),
    });

    const patch = stub.calls.upsert as Record<string, unknown>;
    expect(patch.features_budget).toBe(100);
    expect(patch.features_left).toBe(100);
    expect(patch.stop_by).toBe(SEVEN_AM);
  });
});

describe('pausing and resuming', () => {
  it('pauses only a running night, and says so when there was none', async () => {
    const stub = db(null);
    const { run, error } = await pauseOvernightRun({
      supabase: stub.supabase as never,
      userId: 'user-1',
    });

    expect(stub.calls.update).toEqual({ paused: true });
    expect(stub.filters).toEqual([
      ['user_id', 'user-1'],
      ['running', true],
    ]);
    expect(run).toBeNull();
    expect(error).toBeNull();
  });

  it('resumes without touching the budget or the stop time', async () => {
    const stub = db({ ...rowFor(night({ paused: false })) });
    const { run } = await resumeOvernightRun({
      supabase: stub.supabase as never,
      userId: 'user-1',
    });

    expect(stub.calls.update).toEqual({ paused: false });
    expect(run?.featuresLeft).toBe(6);
    expect(run?.stopBy).toBe(SEVEN_AM);
  });
});

describe('stopping a night', () => {
  it('writes the reason it ended alongside the end', async () => {
    const stub = db(
      rowFor(
        night({
          running: false,
          endedAt: '2026-09-18T02:00:00.000Z',
          endedReason: OVERNIGHT_STOPPED_BY_HAND,
        }),
      ),
    );
    const { run } = await stopOvernightRun({
      supabase: stub.supabase as never,
      userId: 'user-1',
      reason: OVERNIGHT_STOPPED_BY_HAND,
      now: new Date('2026-09-18T02:00:00.000Z'),
    });

    expect(stub.calls.update).toEqual({
      running: false,
      paused: false,
      ended_at: '2026-09-18T02:00:00.000Z',
      ended_reason: OVERNIGHT_STOPPED_BY_HAND,
    });
    // Only a running night is stopped, so the first reason is the one kept.
    expect(stub.filters).toEqual([
      ['user_id', 'user-1'],
      ['running', true],
    ]);
    expect(run?.endedReason).toBe(OVERNIGHT_STOPPED_BY_HAND);
  });

  it('never ends a night with an empty reason', async () => {
    const stub = db(null);
    await stopOvernightRun({ supabase: stub.supabase as never, userId: 'user-1', reason: '   ' });

    expect((stub.calls.update as Record<string, unknown>).ended_reason).toBe(
      OVERNIGHT_STOPPED_BY_HAND,
    );
  });

  it('hands back the failure rather than pretending the night ended', async () => {
    const stub = db(null, { message: 'write refused' });
    const { run, error } = await stopOvernightRun({
      supabase: stub.supabase as never,
      userId: 'user-1',
      reason: 'Nothing assigned to Claude was ready to build.',
    });

    expect(run).toBeNull();
    expect(error).toBe('write refused');
  });
});

describe('recordOvernightFire', () => {
  it('spends one feature of the budget and stamps when it fired', async () => {
    const stub = db(rowFor(night({ featuresLeft: 5 })));
    await recordOvernightFire({
      supabase: stub.supabase as never,
      userId: 'user-1',
      featuresLeft: 6,
      now: new Date(MIDNIGHT),
    });

    expect(stub.calls.update).toEqual({
      features_left: 5,
      last_fired_at: new Date(MIDNIGHT).toISOString(),
    });
  });

  it('will not push the budget below nothing', async () => {
    const stub = db(null);
    await recordOvernightFire({
      supabase: stub.supabase as never,
      userId: 'user-1',
      featuresLeft: 0,
    });

    expect((stub.calls.update as Record<string, unknown>).features_left).toBe(0);
  });
});

/** The database shape of a run, for the stub to hand back. */
function rowFor(run: OvernightRun): Record<string, unknown> {
  return {
    id: run.id,
    running: run.running,
    paused: run.paused,
    features_budget: run.featuresBudget,
    features_left: run.featuresLeft,
    stop_by: run.stopBy,
    started_at: run.startedAt,
    last_fired_at: run.lastFiredAt,
    ended_at: run.endedAt,
    ended_reason: run.endedReason,
    created_at: run.createdAt,
    updated_at: run.updatedAt,
  };
}

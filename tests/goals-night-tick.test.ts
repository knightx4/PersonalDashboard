/**
 * The goals half of the overnight tick (plan #1008): with the runner started
 * and three ready Claude steps on two goals, the ticks send them one goal at a
 * time and stop at the budget, and the runner's pause and stop hold them.
 */
import { describe, expect, it, vi } from 'vitest';
import { goalsNightNote, goalsNightTick, type GoalsNightPorts } from '@/inngest/goals/overnight';
import type { NightGoal, NightRun, NightStep } from '@/lib/goals/overnight-choice';
import { overnightVerdict, type OvernightRun } from '@/lib/plan/overnight';

const START = Date.parse('2026-09-25T22:00:00.000Z');
const TICK = 4 * 60 * 1000;

function night(over: Partial<OvernightRun> = {}): OvernightRun {
  return {
    id: 'night',
    running: true,
    paused: false,
    featuresBudget: 2,
    featuresLeft: 2,
    stopBy: null,
    startedAt: new Date(START).toISOString(),
    lastFiredAt: null,
    endedAt: null,
    endedReason: null,
    lastTickAt: null,
    lastTickNote: null,
    createdAt: new Date(START).toISOString(),
    updatedAt: new Date(START).toISOString(),
    ...over,
  };
}

function step(id: string, goalId: string): NightStep {
  return { id, title: `Step ${id}`, goalId, goalTitle: `Goal ${goalId}`, dueOn: null };
}

function goal(id: string, over: Partial<NightGoal> = {}): NightGoal {
  return {
    id,
    title: `Goal ${id}`,
    status: 'open',
    approvedAt: null,
    createdAt: new Date(START).toISOString(),
    fogChangedAt: null,
    ...over,
  };
}

/** An account in memory: the row, the goals, the ready steps, and the runs the fires write. */
function account(run: OvernightRun, steps: NightStep[], goals: NightGoal[] = []) {
  const state = {
    run,
    goals: [...goals],
    steps: [...steps],
    runs: [] as NightRun[],
    progress: new Map<string, string | null>(),
    fired: [] as string[],
    mapped: [] as string[],
  };
  const ports = (now: number): GoalsNightPorts => ({
    now,
    loadRun: async () => state.run,
    loadNight: async () => ({
      goals: [...state.goals],
      steps: [...state.steps],
      runs: [...state.runs],
      lastProgressAt: new Map(state.progress),
    }),
    fire: async (one) => {
      state.fired.push(one.id);
      state.runs.push({
        goalId: one.goalId,
        stepId: one.id,
        status: 'started',
        createdAt: new Date(now).toISOString(),
      });
      return { ok: true, runId: `run-${one.id}` };
    },
    fireMap: async (one) => {
      state.mapped.push(one.id);
      state.runs.push({
        goalId: one.id,
        stepId: null,
        status: 'started',
        createdAt: new Date(now).toISOString(),
        job: 'goal',
      });
      return { ok: true, runId: `map-${one.id}` };
    },
    recordFire: async (left) => {
      state.run = { ...state.run, featuresLeft: left === null ? null : Math.max(0, left - 1) };
    },
  });
  /** The session on this step finished it: its run is done and the goal moved. */
  const finish = (stepId: string, now: number) => {
    const done = state.runs.find((one) => one.stepId === stepId);
    if (done) done.status = 'done';
    state.steps = state.steps.filter((one) => one.id !== stepId);
    if (done) state.progress.set(done.goalId, new Date(now).toISOString());
  };
  /** The mapping session on this goal finished: its run is done. */
  const finishMap = (goalId: string) => {
    for (const one of state.runs) {
      if (one.job === 'goal' && one.goalId === goalId) one.status = 'done';
    }
  };
  return { state, ports, finish, finishMap };
}

describe('goalsNightTick', () => {
  it('sends three ready steps on two goals one goal at a time, and stops at the budget', async () => {
    const { state, ports, finish } = account(night({ featuresBudget: 2, featuresLeft: 2 }), [
      step('a1', 'A'),
      step('a2', 'A'),
      step('b1', 'B'),
    ]);

    let now = START;
    const first = await goalsNightTick(ports(now));
    expect(first).toMatchObject({ act: 'fired', stepId: 'a1', featuresLeft: 1 });

    // A1's session is still going: nothing else starts, on either goal.
    now += TICK;
    expect(await goalsNightTick(ports(now))).toEqual({ act: 'waiting' });
    expect(state.fired).toEqual(['a1']);

    // Once it finishes, the goal that has gone longer without progress is next.
    finish('a1', now);
    now += TICK;
    expect(await goalsNightTick(ports(now))).toMatchObject({
      act: 'fired',
      stepId: 'b1',
      featuresLeft: 0,
    });

    // The budget of two is spent: A2 is ready and still not sent.
    finish('b1', now);
    now += TICK;
    expect(await goalsNightTick(ports(now))).toEqual({ act: 'spent' });
    expect(state.fired).toEqual(['a1', 'b1']);
    expect(state.run.featuresLeft).toBe(0);
    // And the feature half of the same tick ends the night on it.
    expect(overnightVerdict(state.run, now).act).toBe('end');
  });

  it('works through every step when the budget allows, still one goal at a time', async () => {
    const { state, ports, finish } = account(night({ featuresBudget: 3, featuresLeft: 3 }), [
      step('a1', 'A'),
      step('a2', 'A'),
      step('b1', 'B'),
    ]);
    let now = START;
    for (let i = 0; i < 8; i += 1) {
      const tick = await goalsNightTick(ports(now));
      now += TICK;
      if (tick.act === 'fired') finish(tick.stepId, now);
    }
    expect(state.fired).toEqual(['a1', 'b1', 'a2']);
  });

  it('starts nothing while the runner is held, off, or past its stop time', async () => {
    for (const run of [
      night({ paused: true }),
      night({ running: false }),
      night({ stopBy: new Date(START - 1).toISOString() }),
    ]) {
      const { ports } = account(run, [step('a1', 'A')]);
      const p = ports(START);
      const loadNight = vi.spyOn(p, 'loadNight');
      const tick = await goalsNightTick(p);
      expect(['paused', 'idle', 'spent']).toContain(tick.act);
      expect(loadNight).not.toHaveBeenCalled();
    }
  });

  it('keeps going with no budget, and takes nothing off it', async () => {
    const { state, ports } = account(night({ featuresBudget: null, featuresLeft: null }), [
      step('a1', 'A'),
    ]);
    expect(await goalsNightTick(ports(START))).toMatchObject({ act: 'fired', featuresLeft: null });
    expect(state.run.featuresLeft).toBeNull();
  });

  it('passes over a step the send refuses, and stops at a fire that failed', async () => {
    const { ports } = account(night(), [step('a1', 'A'), step('b1', 'B')]);
    const refusing = ports(START);
    refusing.fire = vi.fn(async (one: NightStep) =>
      one.id === 'a1'
        ? { ok: false as const, error: 'This goal is not approved yet.', refused: true }
        : { ok: true as const, runId: 'run-b1' },
    );
    expect(await goalsNightTick(refusing)).toMatchObject({
      act: 'fired',
      stepId: 'b1',
      refused: ['Step a1'],
    });

    const broken = ports(START);
    broken.fire = vi.fn(async () => ({ ok: false as const, error: 'routine down', refused: false }));
    const recordFire = vi.spyOn(broken, 'recordFire');
    expect(await goalsNightTick(broken)).toEqual({ act: 'failed', error: 'routine down' });
    expect(broken.fire).toHaveBeenCalledTimes(1);
    expect(recordFire).not.toHaveBeenCalled();
  });

  it('says nothing is ready when no Claude step is', async () => {
    const { ports } = account(night(), []);
    expect(await goalsNightTick(ports(START))).toEqual({ act: 'nothing-ready' });
  });
});

describe('goalsNightTick mapping (plan #1009)', () => {
  it('maps a goal added at 10pm before 7am, once, ahead of the ready steps', async () => {
    const added = goal('new', { createdAt: '2026-09-25T22:00:00.000Z' });
    const { state, ports, finishMap, finish } = account(
      night({ featuresBudget: 5, featuresLeft: 5 }),
      [step('b1', 'B')],
      [added, goal('B', { approvedAt: '2026-09-20T12:00:00.000Z' })],
    );

    let now = START;
    expect(await goalsNightTick(ports(now))).toMatchObject({
      act: 'mapped',
      goalId: 'new',
      reason: 'new',
      runId: 'map-new',
      featuresLeft: 4,
    });

    // The map is still being made: nothing else starts.
    now += TICK;
    expect(await goalsNightTick(ports(now))).toEqual({ act: 'waiting' });

    // Mapped; the rest of the night goes to steps and never maps it again.
    finishMap('new');
    const seven = Date.parse('2026-09-26T07:00:00.000Z');
    while (now < seven) {
      now += TICK;
      const tick = await goalsNightTick(ports(now));
      if (tick.act === 'fired') finish(tick.stepId, now);
    }
    expect(state.mapped).toEqual(['new']);
    expect(state.fired).toEqual(['b1']);
    expect(state.run.featuresLeft).toBe(3);
  });

  it('does not map the same goal twice in a night, even when the first run failed', async () => {
    const { state, ports } = account(night(), [], [goal('G')]);
    expect(await goalsNightTick(ports(START))).toMatchObject({ act: 'mapped', goalId: 'G' });
    state.runs[0].status = 'failed';
    expect(await goalsNightTick(ports(START + TICK))).toEqual({ act: 'nothing-ready' });
    expect(state.mapped).toEqual(['G']);
  });

  it('stops at a mapping run that could not be started, and spends nothing on it', async () => {
    const { ports } = account(night(), [step('b1', 'B')], [goal('G')]);
    const broken = ports(START);
    broken.fireMap = vi.fn(async () => ({ ok: false as const, error: 'routine down' }));
    const fire = vi.spyOn(broken, 'fire');
    const recordFire = vi.spyOn(broken, 'recordFire');
    expect(await goalsNightTick(broken)).toEqual({ act: 'failed', error: 'routine down' });
    expect(fire).not.toHaveBeenCalled();
    expect(recordFire).not.toHaveBeenCalled();
  });
});

describe('goalsNightNote', () => {
  it('names the step it started, and is silent otherwise', () => {
    expect(
      goalsNightNote({
        act: 'fired',
        stepId: 's',
        title: 'Draft the cover letter',
        goalTitle: 'Change jobs',
        runId: 'r',
        featuresLeft: 1,
        refused: [],
      }),
    ).toBe('Started the goal step "Draft the cover letter" on "Change jobs".');
    expect(
      goalsNightNote({
        act: 'mapped',
        goalId: 'g',
        goalTitle: 'Change jobs',
        reason: 'fog',
        runId: 'r',
        featuresLeft: 1,
      }),
    ).toBe('Started mapping the goal "Change jobs" again, since its fog changed.');
    expect(goalsNightNote({ act: 'waiting' })).toBeNull();
  });
});

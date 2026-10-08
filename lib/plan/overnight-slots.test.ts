import { describe, expect, it } from 'vitest';

import type { OvernightRun } from './overnight';
import { assignSlots, runnerSlots, SLOT_ASLEEP_DEFAULT, type SlotSession } from './overnight-slots';

const T0 = Date.parse('2026-10-08T22:00:00.000Z');
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

function night(over: Partial<OvernightRun> = {}): OvernightRun {
  return {
    id: 'n1',
    running: true,
    paused: false,
    featuresBudget: null,
    featuresLeft: null,
    stopBy: null,
    startedAt: at(0),
    lastFiredAt: null,
    endedAt: null,
    endedReason: null,
    lastTickAt: null,
    lastTickNote: null,
    createdAt: at(0),
    updatedAt: at(0),
    ...over,
  };
}

function session(id: string, fired: number, ended: number | null = null): SlotSession {
  return {
    id,
    firedAt: at(fired),
    endedAt: ended === null ? null : at(ended),
    step: { number: 100 + Number(id.replace(/\D/g, '') || 0), title: `Step for ${id}` },
    module: `module-${id}`,
    doing: 'Pushed a commit',
  };
}

const states = (slots: ReturnType<typeof runnerSlots>) => slots.map((s) => s.state);

describe('runnerSlots', () => {
  it('is idle all round when the runner is off', () => {
    expect(states(runnerSlots({ run: null, sessions: [], goalRun: null, now: T0 }))).toEqual([
      'idle',
      'idle',
      'idle',
      'idle',
    ]);
    const ended = night({ running: false, endedReason: 'You stopped it.' });
    // A session fired by hand beside an off runner does not wake a Dash.
    const slots = runnerSlots({ run: ended, sessions: [session('a', 1)], goalRun: null, now: T0 });
    expect(states(slots)).toEqual(['idle', 'idle', 'idle', 'idle']);
  });

  it('names four slots in order', () => {
    const slots = runnerSlots({ run: null, sessions: [], goalRun: null, now: T0 });
    expect(slots.map((s) => s.slot)).toEqual(['feature-1', 'feature-2', 'feature-3', 'goals']);
    expect(slots.map((s) => s.label)).toEqual(['Feature 1', 'Feature 2', 'Feature 3', 'Goals']);
  });

  it('shows three running sessions in the order they were fired', () => {
    const slots = runnerSlots({
      run: night(),
      // Handed out of order on purpose.
      sessions: [session('c', 30), session('a', 10), session('b', 20)],
      goalRun: null,
      now: T0 + 60 * 60_000,
    });
    expect(states(slots)).toEqual(['working', 'working', 'working', 'asleep']);
    const work = slots.map((s) => (s.state === 'working' ? s.work : null));
    expect(work[0]).toMatchObject({
      step: 100,
      title: 'Step for a',
      module: 'module-a',
      doing: 'Pushed a commit',
      elapsed: '50m',
    });
    expect(work[1]?.step).toBe(100);
    expect(work[2]?.title).toBe('Step for c');
  });

  it('puts the tick reason on a slot with nothing ready', () => {
    const note = 'Waiting: one session is running, and nothing else is ready outside its module.';
    const slots = runnerSlots({
      run: night({ lastTickNote: note }),
      sessions: [session('a', 1)],
      goalRun: null,
      goalsReason: 'No goal step is ready.',
      now: T0 + 5 * 60_000,
    });
    expect(states(slots)).toEqual(['working', 'asleep', 'asleep', 'asleep']);
    expect(slots[1]).toMatchObject({ reason: note });
    expect(slots[2]).toMatchObject({ reason: note });
    expect(slots[3]).toMatchObject({ reason: 'No goal step is ready.' });
  });

  it('falls back to a plain reason before any tick has written one', () => {
    const slots = runnerSlots({ run: night(), sessions: [], goalRun: null, now: T0 });
    expect(slots[0]).toMatchObject({ state: 'asleep', reason: SLOT_ASLEEP_DEFAULT });
    expect(slots[3]).toMatchObject({ state: 'asleep', reason: SLOT_ASLEEP_DEFAULT });
  });

  it('shows a goals run going in the fourth slot, without a step number', () => {
    const slots = runnerSlots({
      run: night(),
      sessions: [],
      goalRun: { startedAt: at(0), title: 'Book the dentist', doing: 'Reading Gmail' },
      now: T0 + 2 * 60 * 60_000,
    });
    expect(states(slots)).toEqual(['asleep', 'asleep', 'asleep', 'working']);
    expect(slots[3]).toMatchObject({
      state: 'working',
      work: { step: null, title: 'Book the dentist', module: 'goals', elapsed: '2h' },
    });
  });

  it('keeps a session in its slot while another one ends', () => {
    // a, b and c fire in turn; a ends. b and c stay where they were.
    const sessions = [session('a', 0, 40), session('b', 10), session('c', 20)];
    const slots = runnerSlots({ run: night(), sessions, goalRun: null, now: T0 + 50 * 60_000 });
    expect(states(slots)).toEqual(['asleep', 'working', 'working', 'asleep']);
    expect(slots[1].state === 'working' && slots[1].work.title).toBe('Step for b');
    expect(slots[2].state === 'working' && slots[2].work.title).toBe('Step for c');
  });

  it('gives a freed slot to the next session fired, and not to a later slide-up', () => {
    const sessions = [session('a', 0, 40), session('b', 10), session('c', 20), session('d', 45)];
    const slots = runnerSlots({ run: night(), sessions, goalRun: null, now: T0 + 60 * 60_000 });
    expect(slots.map((s) => (s.state === 'working' ? s.work.title : null))).toEqual([
      'Step for d',
      'Step for b',
      'Step for c',
      null,
    ]);
  });

  it('lets a session that ends and one fired at the same instant share a slot', () => {
    const map = assignSlots([session('a', 0, 30), session('b', 30)]);
    expect(map.get('a')).toBe(0);
    expect(map.get('b')).toBe(0);
  });

  it('leaves out a fourth session fired while three are going', () => {
    const map = assignSlots([session('a', 0), session('b', 1), session('c', 2), session('d', 3)]);
    expect(map.has('d')).toBe(false);
    expect(map.size).toBe(3);
  });

  it('lets a held runner finish what is going and sleeps nothing', () => {
    const slots = runnerSlots({
      run: night({ paused: true }),
      sessions: [session('a', 1)],
      goalRun: null,
      now: T0 + 10 * 60_000,
    });
    expect(states(slots)).toEqual(['working', 'idle', 'idle', 'idle']);
  });

  it('gives no elapsed time before the clock has mounted', () => {
    const slots = runnerSlots({ run: night(), sessions: [session('a', 1)], goalRun: null, now: 0 });
    expect(slots[0].state === 'working' && slots[0].work.elapsed).toBeNull();
  });

  it('shows a fire with no step on record as working with no step', () => {
    const blank: SlotSession = { ...session('a', 1), step: null, module: null, doing: null };
    const slots = runnerSlots({ run: night(), sessions: [blank], goalRun: null, now: T0 + 60_000 });
    expect(slots[0]).toMatchObject({ state: 'working', work: { step: null, title: null } });
  });
});

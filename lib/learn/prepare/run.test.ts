import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  finishStep,
  freshSteps,
  PREPARE_BUDGET_MS,
  runPreparation,
  type PreparationPorts,
  type PreparationRow,
  type PreparationStepRow,
  type StepHandler,
} from './run';
import { notBuiltReason, PREPARATION_STEPS, type PreparationStepKey } from './steps';

/**
 * A whole preparation through fake ports: an in-memory run, a clock the
 * handlers move, and handlers that stand in for the model and the network.
 */

const SUBJECT = 'subject-1';

function memory(handlers: Partial<Record<PreparationStepKey, StepHandler>>) {
  let clock = Date.parse('2026-10-16T12:00:00Z');
  let lease: number | null = null;
  const run: PreparationRow = {
    id: 'run-1',
    userId: 'user-1',
    subjectId: SUBJECT,
    status: 'pending',
    currentStep: null,
    startedAt: null,
    finishedAt: null,
    error: null,
    failures: 0,
  };
  const steps = new Map<PreparationStepKey, PreparationStepRow>(freshSteps().map((s) => [s.key, s]));
  const calls: PreparationStepKey[] = [];

  const ports: PreparationPorts = {
    now: () => clock,
    handlers: Object.fromEntries(
      Object.entries(handlers).map(([key, handler]) => [
        key,
        (async (ctx) => {
          calls.push(key as PreparationStepKey);
          return handler!(ctx);
        }) satisfies StepHandler,
      ]),
    ),
    async claim(subjectId, leaseUntil) {
      if (subjectId !== SUBJECT) return null;
      if (lease !== null && lease > clock) return null;
      lease = Date.parse(leaseUntil);
      return {
        run: { ...run },
        steps: [...steps.values()].map((s) => ({ ...s })),
        subject: { id: SUBJECT, userId: 'user-1', name: 'Urban economics', note: 'How cities grow', kind: null },
      };
    },
    async saveRun(_id, patch) {
      const { leaseUntil, ...rest } = patch;
      Object.assign(run, rest);
      if (leaseUntil !== undefined) lease = leaseUntil === null ? null : Date.parse(leaseUntil);
    },
    async saveStep(_id, key, patch) {
      Object.assign(steps.get(key)!, patch);
    },
  };

  return {
    ports,
    run,
    steps,
    calls,
    advance: (ms: number) => {
      clock += ms;
    },
    holdLease: (ms: number) => {
      lease = clock + ms;
    },
    get lease() {
      return lease;
    },
  };
}

/** A handler that takes `ms` of the clock and is done. */
function takes(m: { advance: (ms: number) => void }, ms: number, counts?: Record<string, number>): StepHandler {
  return async () => {
    m.advance(ms);
    return { state: 'done', summary: 'did it', counts };
  };
}

describe('runPreparation', () => {
  it('runs every step in order to the end in one call when there is time', async () => {
    const box: { m?: ReturnType<typeof memory> } = {};
    let drafted = 0;
    const m = memory({
      classify: async () => ({ state: 'done', summary: 'Academic course' }),
      pull_documents: async () => ({ state: 'done', summary: '4 documents stored', counts: { documents: 4 } }),
      match_weeks: async () => ({ state: 'done', counts: { weeks: 9 } }),
      compile_territory: async () => ({ state: 'done', counts: { topics: 6 } }),
      // Two topics a call, so it is called three times.
      draft_topics: async () => {
        drafted += 2;
        box.m!.advance(1000);
        return drafted < 6
          ? { state: 'more', summary: `${drafted} of 6 drafted`, counts: { drafted, remaining: 6 - drafted } }
          : { state: 'done', summary: '6 topics drafted', counts: { drafted, remaining: 0 } };
      },
      write_units: async () => ({ state: 'done', counts: { units: 5 } }),
      finish: finishStep,
    });
    box.m = m;

    const result = await runPreparation(m.ports, SUBJECT);

    expect(result).toEqual({ outcome: 'finished', ran: [...PREPARATION_STEPS] });
    expect(m.calls).toEqual([
      'classify',
      'pull_documents',
      'match_weeks',
      'compile_territory',
      'draft_topics',
      'draft_topics',
      'draft_topics',
      'write_units',
      'finish',
    ]);
    expect([...m.steps.values()].every((s) => s.status === 'done')).toBe(true);
    expect(m.steps.get('draft_topics')).toMatchObject({ calls: 3, summary: '6 topics drafted', counts: { drafted: 6, remaining: 0 } });
    expect(m.steps.get('pull_documents')?.counts).toEqual({ documents: 4 });
    expect(m.steps.get('finish')?.summary).toBe('Prepared in 1 minute.');
    expect(m.run).toMatchObject({ status: 'done', currentStep: null, error: null });
    expect(m.run.startedAt).not.toBeNull();
    expect(m.run.finishedAt).not.toBeNull();
    expect(m.lease).toBeNull();
  });

  it('stops within its budget and carries on at the same step on the next call', async () => {
    const box: { m?: ReturnType<typeof memory> } = {};
    const minute = 60_000;
    const handlers = Object.fromEntries(PREPARATION_STEPS.map((key) => [key, takes({ advance: (ms) => box.m!.advance(ms) }, 100_000)]));
    const m = memory(handlers);
    box.m = m;
    const budget = { budgetMs: 4 * minute, minStepMs: 20_000 };

    // A hundred seconds a step: three fit in four minutes, the third starting
    // with forty seconds left.
    const first = await runPreparation(m.ports, SUBJECT, budget);
    expect(first).toEqual({ outcome: 'paused', step: 'compile_territory', ran: ['classify', 'pull_documents', 'match_weeks'] });
    expect(m.run).toMatchObject({ status: 'running', currentStep: 'compile_territory' });
    expect(m.steps.get('compile_territory')?.status).toBe('pending');
    expect(m.lease).toBeNull();

    const second = await runPreparation(m.ports, SUBJECT, budget);
    expect(second).toEqual({ outcome: 'paused', step: 'finish', ran: ['compile_territory', 'draft_topics', 'write_units'] });

    const third = await runPreparation(m.ports, SUBJECT, budget);
    expect(third).toEqual({ outcome: 'finished', ran: ['finish'] });

    // No step was worked twice.
    expect(m.calls).toEqual([...PREPARATION_STEPS]);
    expect([...m.steps.values()].map((s) => s.calls)).toEqual(PREPARATION_STEPS.map(() => 1));
    expect(m.run.status).toBe('done');
  });

  it('ends the call at once when a step asks to pause, and starts it again on the next', async () => {
    let asked = 0;
    const m = memory({
      compile_territory: async () => {
        asked += 1;
        return asked === 1
          ? { state: 'more', summary: 'Waiting for a fresh call.', pause: true }
          : { state: 'done', summary: 'Laid out 40 topics.' };
      },
      finish: finishStep,
    });

    const first = await runPreparation(m.ports, SUBJECT);
    expect(first).toEqual({ outcome: 'paused', step: 'compile_territory', ran: ['classify', 'pull_documents', 'match_weeks', 'compile_territory'] });
    expect(m.steps.get('compile_territory')).toMatchObject({ status: 'running', summary: 'Waiting for a fresh call.' });
    expect(m.lease).toBeNull();

    const second = await runPreparation(m.ports, SUBJECT);
    expect(second.outcome).toBe('finished');
    expect(asked).toBe(2);
    expect(m.steps.get('compile_territory')).toMatchObject({ status: 'done', calls: 2 });
  });

  it('skips a step whose code has not landed, saying which step builds it', async () => {
    const m = memory({ finish: finishStep });
    const result = await runPreparation(m.ports, SUBJECT);
    expect(result.outcome).toBe('finished');
    expect(m.steps.get('compile_territory')).toMatchObject({ status: 'skipped', summary: notBuiltReason('compile_territory'), calls: 0 });
    expect(notBuiltReason('compile_territory')).toContain('#2276.4');
    expect(m.steps.get('finish')?.status).toBe('done');
    expect(m.run.status).toBe('done');
  });

  it('fails the run on a step that throws, and starts again at that step', async () => {
    let broken = true;
    const m = memory({
      classify: async () => ({ state: 'done' }),
      pull_documents: async () => {
        if (broken) throw new Error('OCW answered 503');
        return { state: 'done', counts: { documents: 2 } };
      },
      finish: finishStep,
    });

    const failed = await runPreparation(m.ports, SUBJECT);
    expect(failed).toEqual({ outcome: 'failed', step: 'pull_documents', error: 'OCW answered 503', ran: ['classify', 'pull_documents'] });
    expect(m.steps.get('pull_documents')).toMatchObject({ status: 'failed', error: 'OCW answered 503', calls: 1 });
    expect(m.run).toMatchObject({ status: 'failed', failures: 1, currentStep: 'pull_documents' });
    expect(m.run.error).toBe('Find syllabi and other structure documents: OCW answered 503');
    expect(m.lease).toBeNull();

    broken = false;
    const resumed = await runPreparation(m.ports, SUBJECT);
    expect(resumed.outcome).toBe('finished');
    expect(m.calls).toEqual(['classify', 'pull_documents', 'pull_documents', 'finish']);
    expect(m.steps.get('pull_documents')).toMatchObject({ status: 'done', error: null, calls: 2, counts: { documents: 2 } });
    expect(m.run).toMatchObject({ status: 'done', error: null, failures: 1 });
  });

  it('leaves a run another call holds alone', async () => {
    const m = memory({ finish: finishStep });
    m.holdLease(60_000);
    expect(await runPreparation(m.ports, SUBJECT)).toEqual({ outcome: 'busy' });
    expect(m.calls).toEqual([]);
    // Once that lease runs out, the run is free again.
    m.advance(61_000);
    expect((await runPreparation(m.ports, SUBJECT)).outcome).toBe('finished');
  });

  it('does nothing more to a finished run', async () => {
    const m = memory({ finish: finishStep });
    await runPreparation(m.ports, SUBJECT);
    const before = m.calls.length;
    expect(await runPreparation(m.ports, SUBJECT)).toEqual({ outcome: 'finished', ran: [] });
    expect(m.calls.length).toBe(before);
    expect(m.lease).toBeNull();
  });

  it('is busy for a subject with no run', async () => {
    const m = memory({});
    expect(await runPreparation(m.ports, 'another-subject')).toEqual({ outcome: 'busy' });
  });
});

describe('the route that works a run', () => {
  it('outlives the budget, so the hand-off is made before it is stopped', () => {
    const source = readFileSync(join(process.cwd(), 'app/api/cron/learn-prepare/route.ts'), 'utf8');
    const match = source.match(/export const maxDuration = (\d+);/);
    expect(match).not.toBeNull();
    expect(Number(match![1]) * 1000).toBeGreaterThanOrEqual(PREPARE_BUDGET_MS + 30_000);
  });
});

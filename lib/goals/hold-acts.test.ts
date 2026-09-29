import { describe, expect, it, vi } from 'vitest';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  ACTS_MAX,
  ACTS_QUESTION,
  actsState,
  checkActs,
  cleanActsSentence,
  fallbackActsSentence,
  holdsAt,
  type ActsCandidate,
} from '@/lib/goals/hold-acts';
import { holdActingSteps } from '@/lib/goals/hold-acts-store';

const USER = '11111111-1111-4111-8111-111111111111';

const landlord: ActsCandidate = {
  id: 'step-landlord',
  title: 'Email the landlord',
  detail: 'Ask for the lease renewal terms before the 1 November deadline.',
  acceptance: 'The landlord has the email.',
};
const research: ActsCandidate = {
  id: 'step-research',
  title: 'Compare three bar carts',
  detail: null,
  acceptance: 'Two or three carts with size, price and link.',
};

describe('the acts question', () => {
  it('asks the yes/no question the brief names', () => {
    expect(ACTS_QUESTION.type).toBe('yes-no');
    expect(ACTS_QUESTION.question).toBe(
      'Does working this step send, submit, book, buy, share, or change records outside the goals schema?',
    );
  });

  it('reads the title, detail and done-when, leaving out what is empty', () => {
    expect(actsState(landlord)).toBe(
      'Step: Email the landlord\nDetail: Ask for the lease renewal terms before the 1 November deadline.\nDone when: The landlord has the email.',
    );
    expect(actsState(research)).toBe('Step: Compare three bar carts\nDone when: Two or three carts with size, price and link.');
  });

  it('holds at a yes of 0.3 or more', () => {
    expect(holdsAt(0.3)).toBe(true);
    expect(holdsAt(0.29)).toBe(false);
  });
});

describe('checkActs', () => {
  it('keeps the order, holds above the line and never holds an unanswered step', async () => {
    const answers: Record<string, number | null> = { a: 0.9, b: 0.1, c: null };
    const steps = ['a', 'b', 'c', 'd'].map((id) => ({ id, title: id, detail: null, acceptance: null }));
    const checks = await checkActs(steps, async (step) => {
      if (step.id === 'd') throw new Error('boom');
      return answers[step.id] ?? null;
    }, 2);
    expect(checks.map((c) => [c.step.id, c.probability, c.held])).toEqual([
      ['a', 0.9, true],
      ['b', 0.1, false],
      ['c', null, false],
      ['d', null, false],
    ]);
  });
});

describe('the acts sentence', () => {
  it('is one line with no wrapping quotes, ending in a full stop', () => {
    expect(cleanActsSentence('  "Sends the renewal request to the landlord\nfrom your Gmail"  ')).toBe(
      'Sends the renewal request to the landlord from your Gmail.',
    );
    expect(cleanActsSentence('')).toBeNull();
    expect(cleanActsSentence(42)).toBeNull();
    expect(cleanActsSentence('x'.repeat(900))!.length).toBeLessThanOrEqual(ACTS_MAX);
  });

  it('falls back to a sentence naming the step', () => {
    const sentence = fallbackActsSentence(landlord);
    expect(sentence).toContain('"Email the landlord"');
    expect(sentence.length).toBeLessThanOrEqual(ACTS_MAX);
  });
});

/** Answers the candidates read and records every call to hold_acting_step. */
function fakeClient(rows: Record<string, unknown>[]) {
  const rpc = vi.fn(async () => ({ data: true, error: null }));
  const filters: unknown[][] = [];
  const builder: Record<string, unknown> = {
    then(resolve: (value: unknown) => unknown) {
      return Promise.resolve({ data: rows, error: null }).then(resolve);
    },
  };
  for (const name of ['select', 'eq', 'in', 'is']) {
    builder[name] = (...args: unknown[]) => {
      filters.push([name, ...args]);
      return builder;
    };
  }
  const spend = vi.fn(async () => ({ error: null }));
  const core = { from: () => ({ insert: spend }) };
  const client = {
    from: () => builder,
    rpc,
    schema: () => core,
  } as unknown as GoalsSupabaseClient;
  return { client, rpc, filters };
}

function row(step: ActsCandidate, status = 'open', blockKind: string | null = null) {
  return { ...step, status, block_kind: blockKind };
}

const ask = async (step: ActsCandidate) => (step.id === landlord.id ? 0.95 : 0.02);

describe('holdActingSteps', () => {
  it('in report mode lists what it would hold and writes nothing', async () => {
    const { client, rpc } = fakeClient([row(landlord), row(research)]);
    const result = await holdActingSteps({ client, userId: USER, mode: 'report', enabled: true, ask });
    expect(result).toEqual({
      mode: 'report',
      checked: 2,
      unanswered: 0,
      held: [{ id: landlord.id, title: 'Email the landlord', probability: 0.95 }],
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('switched on, turns "Email the landlord" into a proposal with its sentence and leaves research alone', async () => {
    const { client, rpc, filters } = fakeClient([row(landlord), row(research)]);
    const write = vi.fn(async () => 'Sends the renewal request to the landlord from your Gmail.');
    const result = await holdActingSteps({ client, userId: USER, mode: 'hold', enabled: true, ask, write });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('hold_acting_step', {
      step: landlord.id,
      sentence: 'Sends the renewal request to the landlord from your Gmail.',
    });
    expect(write).toHaveBeenCalledWith(landlord);
    expect(result).toMatchObject({ mode: 'hold', checked: 2, held: [{ id: landlord.id }] });
    expect(filters).toContainEqual(['eq', 'user_id', USER]);
    expect(filters).toContainEqual(['is', 'acts', null]);
  });

  it('holds with the fallback sentence when Haiku writes nothing', async () => {
    const { client, rpc } = fakeClient([row(landlord)]);
    await holdActingSteps({ client, userId: USER, mode: 'hold', enabled: true, ask, write: async () => null });
    expect(rpc).toHaveBeenCalledWith('hold_acting_step', { step: landlord.id, sentence: fallbackActsSentence(landlord) });
  });

  it('leaves every step as it is when Jev does not answer', async () => {
    const { client, rpc } = fakeClient([row(landlord)]);
    const result = await holdActingSteps({ client, userId: USER, enabled: true, ask: async () => null });
    expect(result).toMatchObject({ checked: 1, unanswered: 1, held: [] });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('skips a step blocked on the person and checks one blocked on other steps', async () => {
    const onPerson = { ...landlord, id: 'blocked-outside' };
    const onSteps = { ...landlord, id: 'blocked-steps' };
    const { client } = fakeClient([row(onPerson, 'blocked', 'outside'), row(onSteps, 'blocked', 'steps')]);
    const asked: string[] = [];
    await holdActingSteps({
      client,
      userId: USER,
      mode: 'report',
      enabled: true,
      ask: async (step) => {
        asked.push(step.id);
        return 0.9;
      },
    });
    expect(asked).toEqual(['blocked-steps']);
  });

  it('asks nothing for an account that has not agreed to send text to Jev', async () => {
    const { client } = fakeClient([row(landlord)]);
    const spy = vi.fn(ask);
    const result = await holdActingSteps({ client, userId: USER, enabled: false, ask: spy });
    expect(result).toHaveProperty('skipped');
    expect(spy).not.toHaveBeenCalled();
  });
});

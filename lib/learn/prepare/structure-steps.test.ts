import type { ProviderId } from '@/lib/learn/goal-kind';
import { describe, expect, it, vi } from 'vitest';
import type { StepContext, PreparationStepRow } from './run';
import { classifyStep, matchStep, pullStep, withAddedWeeks, type PulledDocument } from './structure-steps';

function ctx(over: { detail?: Record<string, unknown>; now?: number; deadline?: number } = {}): StepContext {
  const step: PreparationStepRow = {
    key: 'classify',
    ordinal: 1,
    status: 'running',
    startedAt: null,
    finishedAt: null,
    summary: null,
    counts: {},
    detail: over.detail ?? {},
    calls: 0,
    error: null,
  };
  return {
    subject: { id: 's1', userId: 'u1', name: 'Beekeeping', note: 'Keep two hives', kind: null },
    run: { id: 'r1', userId: 'u1', subjectId: 's1', status: 'running', currentStep: 'classify', startedAt: null, finishedAt: null, error: null, failures: 0 },
    step,
    steps: new Map(),
    deadline: over.deadline ?? 1_000_000,
    now: () => over.now ?? 0,
  };
}

describe('classifyStep', () => {
  it('writes the model kind once and reports it', async () => {
    const write = vi.fn(async () => true);
    const out = await classifyStep({
      read: async () => ({ kind: null, by: null, reason: null }),
      classify: async () => ({ ok: true, kind: 'practical_skill', reason: 'Learned by doing.' }),
      write,
    })(ctx());
    expect(write).toHaveBeenCalledWith('s1', { kind: 'practical_skill', reason: 'Learned by doing.' });
    expect(out).toMatchObject({ state: 'done', detail: { kind: 'practical_skill', by: 'model' } });
  });

  it('never calls the model or writes over a kind that is already there', async () => {
    const classify = vi.fn();
    const write = vi.fn();
    const out = await classifyStep({
      read: async () => ({ kind: 'institution', by: 'person', reason: 'Set by you.' }),
      classify,
      write,
    })(ctx());
    expect(classify).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(out).toMatchObject({ state: 'done', detail: { kind: 'institution', by: 'person' } });
  });

  it('reports the kind the person set when it landed while the call ran', async () => {
    let reads = 0;
    const out = await classifyStep({
      read: async () => (reads++ === 0 ? { kind: null, by: null, reason: null } : { kind: 'broad_field', by: 'person', reason: 'Set by you.' }),
      classify: async () => ({ ok: true, kind: 'practical_skill', reason: 'x' }),
      write: async () => false,
    })(ctx());
    expect(out).toMatchObject({ detail: { kind: 'broad_field', by: 'person' } });
  });

  it('throws when the call fails, so the step is retried', async () => {
    await expect(
      classifyStep({ read: async () => ({ kind: null, by: null, reason: null }), classify: async () => ({ ok: false, detail: 'Rate limited.' }), write: vi.fn() })(ctx()),
    ).rejects.toThrow('Rate limited.');
  });
});

const DOC: PulledDocument = { itemId: 'i1', title: 'Hive management', provider: 'Extension', url: 'https://x.test/hive', licence: 'open', units: 8 };

describe('pullStep', () => {
  it('skips with the reason when no provider of the kind has code', async () => {
    const run = vi.fn();
    const out = await pullStep({ wired: () => [], run, describe: async () => [] }, async () => 'practical_skill')(ctx());
    expect(run).not.toHaveBeenCalled();
    expect(out.state).toBe('skipped');
  });

  it('stores documents and lists them with provider and link', async () => {
    const out = await pullStep(
      {
        wired: () => ['extension', 'certification'],
        run: async (provider) => ({
          provider,
          ok: true,
          lines: provider === 'extension' ? [{ candidate: 'a', status: 'stored', itemId: 'i1', units: 8, unchanged: false }] : [],
        }),
        describe: async () => [DOC],
      },
      async () => 'practical_skill',
    )(ctx());
    expect(out).toMatchObject({ state: 'done', counts: { documents: 1, units: 8 } });
    expect((out as unknown as { detail: { documents: PulledDocument[] } }).detail.documents).toEqual([DOC]);
  });

  it('records candidates that were not stored and counts them in the summary', async () => {
    const out = await pullStep(
      {
        wired: () => ['extension'],
        run: async (provider) => ({
          provider,
          ok: true,
          lines: [
            { candidate: 'a', status: 'stored', itemId: 'i1', units: 8, unchanged: false },
            { candidate: 'b', status: 'not-confirmed', detail: 'not a syllabus' },
            { candidate: 'c', status: 'failed', detail: 'getaddrinfo ENOTFOUND' },
          ],
        }),
        describe: async () => [DOC],
      },
      async () => 'practical_skill',
    )(ctx());
    expect(out).toMatchObject({ state: 'done', counts: { proposed: 3, confirmed: 2, storeFailed: 1 } });
    if (out.state !== 'done') throw new Error('expected done');
    expect(out.summary).toContain('3 candidates proposed, 2 confirmed, 1 failed to store: getaddrinfo ENOTFOUND.');
    expect((out.detail as { candidates: unknown[] }).candidates).toEqual([
      { provider: 'extension', candidate: 'b', status: 'not-confirmed', detail: 'not a syllabus' },
      { provider: 'extension', candidate: 'c', status: 'failed', detail: 'getaddrinfo ENOTFOUND' },
    ]);
  });

  it('fails the step when every confirmed candidate failed to store', async () => {
    const describe = vi.fn();
    const out = await pullStep(
      {
        wired: () => ['extension'],
        run: async (provider) => ({
          provider,
          ok: true,
          lines: [
            { candidate: 'a', status: 'failed', detail: 'getaddrinfo ENOTFOUND' },
            { candidate: 'b', status: 'failed', detail: 'getaddrinfo ENOTFOUND' },
          ],
        }),
        describe,
      },
      async () => 'practical_skill',
    )(ctx());
    expect(out.state).toBe('failed');
    if (out.state !== 'failed') throw new Error('expected failed');
    expect(out.error).toContain('2 failed to store: getaddrinfo ENOTFOUND');
    expect((out.detail as { candidates: unknown[] }).candidates).toHaveLength(2);
    expect(describe).not.toHaveBeenCalled();

    // The retry searches again rather than reading the failed call as finished.
    const run = vi.fn(async (provider: ProviderId) => ({ provider, ok: true as const, lines: [] }));
    const again = await pullStep({ wired: () => ['extension'], run, describe: async () => [] }, async () => 'practical_skill')(
      ctx({ detail: out.detail }),
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(again.state).toBe('done');
  });

  it('returns more before the deadline and resumes without repeating a provider', async () => {
    const calls: string[] = [];
    const ports = {
      wired: (): ProviderId[] => ['extension', 'certification'],
      run: async (provider: ProviderId) => {
        calls.push(provider);
        return { provider, ok: true as const, lines: [] };
      },
      describe: async () => [],
    };
    const handler = pullStep(ports, async () => 'practical_skill');
    const first = await handler(ctx({ now: 950_000, deadline: 1_000_000 }));
    expect(first.state).toBe('more');
    expect(calls).toEqual(['extension']);
    const second = await handler(ctx({ detail: (first as { detail: Record<string, unknown> }).detail }));
    expect(second.state).toBe('done');
    expect(calls).toEqual(['extension', 'certification']);
  });
});

describe('matchStep', () => {
  const week = (n: number, similarity: number) => ({ segmentId: `s${n}`, itemId: `i${n % 2}`, ordinal: n, label: null, heading: `Week ${n}`, similarity });

  it('records how many weeks it found', async () => {
    const out = await matchStep({ embed: async () => ({ finished: true }), find: async () => ({ ok: true, weeks: [week(1, 0.5), week(2, 0.7), week(3, 0.6)] }) })(ctx());
    expect(out).toMatchObject({ state: 'done', counts: { weeks: 3, documents: 2 } });
    expect((out as unknown as { detail: { weeks: { similarity: number }[] } }).detail.weeks[0]?.similarity).toBe(0.7);
  });

  it('returns more when embedding ran out of time', async () => {
    const find = vi.fn();
    const out = await matchStep({ embed: async () => ({ finished: false }), find })(ctx());
    expect(out.state).toBe('more');
    expect(find).not.toHaveBeenCalled();
  });

  it('finishes with none found rather than failing', async () => {
    const out = await matchStep({ embed: async () => ({ finished: true }), find: async () => ({ ok: true, weeks: [] }) })(ctx());
    expect(out).toMatchObject({ state: 'done', counts: { weeks: 0 } });
  });

  it('keeps every week of an added document, however far it scores, and names the documents', async () => {
    const added = [{ ...week(9, 0.1), itemId: 'added' }];
    const out = await matchStep({
      embed: async () => ({ finished: true }),
      find: async () => ({ ok: true, weeks: [week(1, 0.5)] }),
      added: async () => ({ itemIds: ['added'], weeks: added }),
    })(ctx());
    expect(out).toMatchObject({ state: 'done', counts: { weeks: 2, documents: 2 }, detail: { added: ['added'] } });
  });
});

describe('withAddedWeeks', () => {
  const w = (id: string, similarity: number) => ({ segmentId: id, itemId: 'i', ordinal: 0, label: null, heading: id, similarity });

  it('caps the found weeks but never the added ones, and lists none twice', () => {
    const weeks = withAddedWeeks([w('a', 0.9), w('b', 0.8), w('c', 0.7)], [w('c', 0.7), w('x', 0.2), w('y', 0.1)], 2);
    expect(weeks.map((x) => x.segmentId)).toEqual(['a', 'b', 'c', 'x', 'y']);
  });
});

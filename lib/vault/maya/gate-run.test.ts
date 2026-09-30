import { describe, expect, it } from 'vitest';
import type { JevResult, JevYesNoAnswer } from '@/lib/jev/wire';
import {
  MAYA_DAILY_THOUGHTS,
  MAYA_GATE_LOOKBACK_HOURS,
  MAYA_THINK_BUDGET_MS,
  runMayaGateFor,
  type GateCandidate,
  type GateCheckRow,
  type GateRunPorts,
  type PriorCheck,
  type ThinkResult,
} from './gate-run';

const USER = 'user-1';
const NOW = new Date('2026-09-30T12:47:00Z');
const BODY = 'Is the sequencing argument actually right, or does the second view hold up better? '.repeat(3);

function note(id: string, overrides: Partial<GateCandidate> = {}): GateCandidate {
  return { id, path: `Ideas/${id}.md`, title: id, body: BODY, blobSha: `sha-${id}`, ...overrides };
}

function yes(probability: number): JevResult<JevYesNoAnswer> {
  return {
    ok: true,
    model: 'jev-1.13.0',
    answer: { type: 'yes-no', yes: probability >= 0.5, probability, confidence: Math.abs(2 * probability - 1) },
  };
}

function fakePorts(input: {
  notes: GateCandidate[];
  probabilities?: Record<string, number | 'fail'>;
  prior?: PriorCheck[];
  threaded?: string[];
  enabled?: boolean;
  automatic?: number;
  think?: (id: string) => ThinkResult;
  elapsed?: number;
}) {
  const recorded: GateCheckRow[] = [];
  const asked: string[] = [];
  const thought: string[] = [];
  let since: Date | null = null;
  const ports: GateRunPorts = {
    async changedNotes(_user, from) {
      since = from;
      return input.notes;
    },
    async priorChecks() {
      return input.prior ?? [];
    },
    async threadedNotes() {
      return new Set(input.threaded ?? []);
    },
    async jevEnabled() {
      return input.enabled ?? true;
    },
    async ask(_user, n) {
      asked.push(n.id);
      const p = input.probabilities?.[n.id] ?? 0.1;
      return p === 'fail' ? { ok: false, reason: 'timeout', detail: 'slow' } : yes(p);
    },
    async automaticSince() {
      return input.automatic ?? 0;
    },
    async think(_user, n) {
      thought.push(n.id);
      return input.think ? input.think(n.id) : { ok: true, threadId: `thread-${n.id}` };
    },
    async record(_user, rows) {
      recorded.push(...rows);
    },
    elapsedMs: () => input.elapsed ?? 0,
  };
  return { ports, recorded, asked, thought, since: () => since };
}

describe('Maya hourly gate', () => {
  it('reads only notes changed inside the lookback, so the first tick is not the whole vault', async () => {
    const fake = fakePorts({ notes: [] });
    await runMayaGateFor(fake.ports, USER, NOW);
    expect(NOW.getTime() - fake.since()!.getTime()).toBe(MAYA_GATE_LOOKBACK_HOURS * 3_600_000);
  });

  it('records one check per note version and opens a thread only above the threshold', async () => {
    const fake = fakePorts({
      notes: [note('a'), note('b'), note('c')],
      probabilities: { a: 0.97, b: 0.94, c: 0.2 },
    });
    const result = await runMayaGateFor(fake.ports, USER, NOW);

    expect(fake.asked).toEqual(['a', 'b', 'c']);
    expect(fake.thought).toEqual(['a']);
    expect(fake.recorded.map((row) => [row.noteId, row.blobSha, row.outcome])).toEqual([
      ['b', 'sha-b', 'skip'],
      ['c', 'sha-c', 'skip'],
      ['a', 'sha-a', 'thought'],
    ]);
    expect(fake.recorded.find((row) => row.noteId === 'a')).toMatchObject({ probability: 0.97, jevModel: 'jev-1.13.0' });
    expect(result).toMatchObject({ read: 3, asked: 3, passed: 1, thoughts: 1 });
  });

  it('does not ask again about a version already checked, or a note that has a thread', async () => {
    const fake = fakePorts({
      notes: [note('a'), note('b'), note('c'), note('d')],
      prior: [
        { noteId: 'a', blobSha: 'sha-a', outcome: 'skip', probability: 0.3 },
        { noteId: 'b', blobSha: 'old-sha', outcome: 'skip', probability: 0.3 },
        { noteId: 'd', blobSha: 'sha-d', outcome: 'failed', probability: null },
      ],
      threaded: ['c'],
    });
    await runMayaGateFor(fake.ports, USER, NOW);
    // b has grown since its last check; d's Jev call failed and is tried again.
    expect(fake.asked).toEqual(['b', 'd']);
  });

  it('does not ask again about a note that passed but whose thought failed', async () => {
    const fake = fakePorts({
      notes: [note('a')],
      prior: [{ noteId: 'a', blobSha: 'sha-a', outcome: 'failed', probability: 0.98 }],
    });
    await runMayaGateFor(fake.ports, USER, NOW);
    expect(fake.asked).toEqual([]);
  });

  it('writes at most the daily cap, highest probability first, and records the rest as skip', async () => {
    const fake = fakePorts({
      notes: [note('a'), note('b'), note('c'), note('d')],
      probabilities: { a: 0.96, b: 0.99, c: 0.97, d: 0.98 },
      automatic: 0,
    });
    const result = await runMayaGateFor(fake.ports, USER, NOW);
    const byProbability = ['b', 'd', 'c', 'a'];
    expect(MAYA_DAILY_THOUGHTS).toBeLessThan(byProbability.length);
    expect(fake.thought).toEqual(byProbability.slice(0, MAYA_DAILY_THOUGHTS));
    for (const id of byProbability.slice(MAYA_DAILY_THOUGHTS)) {
      expect(fake.recorded.find((row) => row.noteId === id)).toMatchObject({ outcome: 'skip' });
    }
    expect(result.thoughts).toBe(MAYA_DAILY_THOUGHTS);
  });

  it('counts what the day has already written against the cap', async () => {
    const fake = fakePorts({
      notes: [note('a'), note('b')],
      probabilities: { a: 0.96, b: 0.99 },
      automatic: MAYA_DAILY_THOUGHTS - 1,
    });
    const result = await runMayaGateFor(fake.ports, USER, NOW);
    expect(fake.thought).toEqual(['b']);
    expect(result.thoughts).toBe(1);
  });

  it('writes nothing once the day already has its cap', async () => {
    const fake = fakePorts({ notes: [note('a')], probabilities: { a: 0.99 }, automatic: MAYA_DAILY_THOUGHTS });
    await runMayaGateFor(fake.ports, USER, NOW);
    expect(fake.thought).toEqual([]);
    expect(fake.recorded).toEqual([
      { noteId: 'a', blobSha: 'sha-a', outcome: 'skip', probability: 0.99, jevModel: 'jev-1.13.0' },
    ]);
  });

  it('never asks Jev when the account has not opted in, and records not_enabled', async () => {
    const fake = fakePorts({ notes: [note('a')], enabled: false });
    await runMayaGateFor(fake.ports, USER, NOW);
    expect(fake.asked).toEqual([]);
    expect(fake.thought).toEqual([]);
    expect(fake.recorded.map((row) => row.outcome)).toEqual(['not_enabled']);
  });

  it('never asks Jev about a refused note: the Me folder, or one too short', async () => {
    const fake = fakePorts({ notes: [note('a', { path: 'Me/Journal/a.md' }), note('b', { body: 'short' })] });
    await runMayaGateFor(fake.ports, USER, NOW);
    expect(fake.asked).toEqual([]);
    expect(fake.recorded.map((row) => [row.noteId, row.outcome, row.probability])).toEqual([
      ['a', 'skip', null],
      ['b', 'skip', null],
    ]);
  });

  it('records a failed Jev call without a probability, so the next tick asks again', async () => {
    const fake = fakePorts({ notes: [note('a')], probabilities: { a: 'fail' } });
    await runMayaGateFor(fake.ports, USER, NOW);
    expect(fake.recorded).toEqual([
      { noteId: 'a', blobSha: 'sha-a', outcome: 'failed', probability: null, jevModel: null },
    ]);
  });

  it('records a thought with no points as skip and a failed one as failed', async () => {
    const fake = fakePorts({
      notes: [note('a'), note('b')],
      probabilities: { a: 0.99, b: 0.98 },
      think: (id) => (id === 'a' ? { ok: false, empty: true, detail: 'nothing' } : { ok: false, empty: false, detail: 'boom' }),
    });
    await runMayaGateFor(fake.ports, USER, NOW);
    expect(fake.recorded.map((row) => [row.noteId, row.outcome])).toEqual([
      ['a', 'skip'],
      ['b', 'failed'],
    ]);
  });

  it('leaves a passing note unrecorded when the run is out of time, so the next tick reaches it', async () => {
    const fake = fakePorts({ notes: [note('a')], probabilities: { a: 0.99 }, elapsed: MAYA_THINK_BUDGET_MS + 1 });
    const result = await runMayaGateFor(fake.ports, USER, NOW);
    expect(fake.thought).toEqual([]);
    expect(fake.recorded).toEqual([]);
    expect(result.deferred).toBe(1);
  });
});

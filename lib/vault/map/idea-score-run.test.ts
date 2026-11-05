import { describe, expect, it } from 'vitest';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { IDEA_SCORE_RUBRIC_VERSION, ideaScoreState, type IdeaScore, type IdeaScoreResult, type IdeaToScore } from './idea-score';
import {
  BATCH_PAUSE_MS,
  IDEA_SCORE_BATCH,
  RATE_LIMIT_PAUSE_MS,
  RATE_LIMIT_RETRIES,
  runIdeaScores,
  type IdeaScorePorts,
  type LoadedIdea,
} from './idea-score-run';
import { DEFAULT_VAULT_RULES } from './rules';

/**
 * The loop that scores the map's ideas (plan #2947.3), against an in-memory
 * store and a stubbed Jev. Nothing here reaches the database or TypeSafe.
 */

function idea(n: number): IdeaToScore {
  return {
    statement: `Idea ${n}`,
    basis: 'Read in a section.',
    sources: [
      {
        quote: `Quote ${n}.`,
        note: { title: `Note ${n}`, path: `Ideas/Note ${n}.md`, voice: 'private', body: `Before.\n\nQuote ${n}. More.` },
      },
    ],
  };
}

function score(inputHash: string): IdeaScore {
  return {
    ideaType: 'own_idea',
    typeConfidence: 0.9,
    typeProbabilities: { own_idea: 0.9, project_design: 0.1, requirement: 0, others_idea: 0, description: 0 },
    usefulness: 40,
    usefulnessConfidence: 0.5,
    usefulnessLevels: [0, 0, 0, 1, 0, 0, 0, 0, 0, 0],
    novelty: 20,
    noveltyConfidence: 0.5,
    noveltyLevels: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
    model: 'jev-1.13.0',
    rubricVersion: IDEA_SCORE_RUBRIC_VERSION,
    inputHash,
  };
}

type Stored = { inputHash: string; rubricVersion: string; sig: string };

function harness(opts: {
  count: number;
  stored?: Record<string, Stored>;
  sigs?: Record<string, string>;
  answer?: (id: string, call: number) => IdeaScoreResult | null;
  clockStep?: number;
}) {
  const ideas = new Map<string, IdeaToScore>();
  for (let n = 0; n < opts.count; n++) ideas.set(`p${String(n).padStart(4, '0')}`, idea(n));
  const stored = new Map<string, Stored>(Object.entries(opts.stored ?? {}));
  const sigOf = (id: string) => opts.sigs?.[id] ?? `sig-${id}`;
  const calls = new Map<string, number>();
  const sleeps: number[] = [];
  const ledgers: SpendReport[][] = [];
  let clock = 0;

  const ports: IdeaScorePorts = {
    async due(limit) {
      return [...ideas.keys()]
        .filter((id) => {
          const row = stored.get(id);
          return !row || row.rubricVersion !== IDEA_SCORE_RUBRIC_VERSION || row.sig !== sigOf(id);
        })
        .sort((a, b) => Number(stored.has(a)) - Number(stored.has(b)) || a.localeCompare(b))
        .slice(0, limit)
        .map((positionId) => ({ positionId, sourceSig: sigOf(positionId) }));
    },
    async load(ids) {
      return new Map(
        ids.flatMap((id): [string, LoadedIdea][] => {
          const value = ideas.get(id);
          if (!value) return [];
          const row = stored.get(id);
          return [[id, { idea: value, stored: row ? { inputHash: row.inputHash, rubricVersion: row.rubricVersion } : null }]];
        }),
      );
    },
    async score(value, onSpend) {
      const id = [...ideas.entries()].find(([, v]) => v === value)![0];
      const call = (calls.get(id) ?? 0) + 1;
      calls.set(id, call);
      onSpend({ model: 'jev-1.13.0', usage: { inputTokens: 100, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0 } });
      return opts.answer?.(id, call) ?? { ok: true, score: score(ideaScoreState(value).inputHash) };
    },
    async save(id, s, sig) {
      stored.set(id, { inputHash: s.inputHash, rubricVersion: s.rubricVersion, sig });
    },
    async touch(id, sig) {
      stored.set(id, { ...stored.get(id)!, sig });
    },
    async ledger(reports) {
      ledgers.push(reports);
    },
    async sleep(ms) {
      sleeps.push(ms);
    },
    now: () => (clock += opts.clockStep ?? 0),
  };
  return { ports, stored, calls, sleeps, ledgers, ideas };
}

describe('runIdeaScores', () => {
  it('scores every idea in batches and catches up', async () => {
    const h = harness({ count: IDEA_SCORE_BATCH * 2 + 7 });
    const result = await runIdeaScores({ ports: h.ports, rules: DEFAULT_VAULT_RULES, deadline: 1 });
    expect(result).toEqual({ scored: 107, unchanged: 0, failed: 0, caughtUp: true, stopped: null });
    expect(h.stored.size).toBe(107);
    // One ledger write per batch, and the pause between batches.
    expect(h.ledgers.map((l) => l.length)).toEqual([50, 50, 7]);
    expect(h.sleeps).toEqual([BATCH_PAUSE_MS, BATCH_PAUSE_MS, BATCH_PAUSE_MS]);
  });

  it('stores the new signature without asking Jev when what Jev reads is unchanged', async () => {
    const hash = ideaScoreState(idea(0)).inputHash;
    const h = harness({
      count: 1,
      stored: { p0000: { inputHash: hash, rubricVersion: IDEA_SCORE_RUBRIC_VERSION, sig: 'old' } },
    });
    const result = await runIdeaScores({ ports: h.ports, rules: DEFAULT_VAULT_RULES, deadline: 1 });
    expect(result.unchanged).toBe(1);
    expect(result.scored).toBe(0);
    expect(h.calls.size).toBe(0);
    expect(h.stored.get('p0000')?.sig).toBe('sig-p0000');
  });

  it('asks again when the hash or the rubric differs', async () => {
    const hash = ideaScoreState(idea(1)).inputHash;
    const h = harness({
      count: 2,
      stored: {
        p0000: { inputHash: 'changed', rubricVersion: IDEA_SCORE_RUBRIC_VERSION, sig: 'old' },
        p0001: { inputHash: hash, rubricVersion: 'idea-score-2026-11-v2', sig: 'sig-p0001' },
      },
    });
    const result = await runIdeaScores({ ports: h.ports, rules: DEFAULT_VAULT_RULES, deadline: 1 });
    expect(result.scored).toBe(2);
    expect(h.stored.get('p0001')?.rubricVersion).toBe(IDEA_SCORE_RUBRIC_VERSION);
  });

  it('leaves an idea Jev could not answer for the next run and carries on', async () => {
    const h = harness({
      count: 3,
      answer: (id) => (id === 'p0001' ? { ok: false, reason: 'malformed', detail: 'no answer' } : null),
    });
    const result = await runIdeaScores({ ports: h.ports, rules: DEFAULT_VAULT_RULES, deadline: 1 });
    expect(result).toMatchObject({ scored: 2, failed: 1, caughtUp: false, stopped: null });
    expect(h.stored.has('p0001')).toBe(false);
    expect(h.calls.get('p0001')).toBe(1);
  });

  it('waits out a rate limit with growing pauses and then scores', async () => {
    const h = harness({
      count: 1,
      answer: (_, call) => (call <= 2 ? { ok: false, reason: 'rate-limited', detail: '429' } : null),
    });
    const result = await runIdeaScores({ ports: h.ports, rules: DEFAULT_VAULT_RULES, deadline: 1 });
    expect(result.scored).toBe(1);
    expect(h.sleeps.slice(0, 2)).toEqual([RATE_LIMIT_PAUSE_MS, RATE_LIMIT_PAUSE_MS * 2]);
  });

  it('stops the run when the rate limit does not lift', async () => {
    const h = harness({ count: 3, answer: () => ({ ok: false, reason: 'overloaded', detail: '529' }) });
    const result = await runIdeaScores({ ports: h.ports, rules: DEFAULT_VAULT_RULES, deadline: 1 });
    expect(result.stopped?.reason).toBe('overloaded');
    expect(result.failed).toBe(1);
    expect(h.calls.get('p0000')).toBe(RATE_LIMIT_RETRIES + 1);
    expect(h.calls.has('p0001')).toBe(false);
  });

  it('stops at once without a key', async () => {
    const h = harness({ count: 3, answer: () => ({ ok: false, reason: 'no-key', detail: 'unset' }) });
    const result = await runIdeaScores({ ports: h.ports, rules: DEFAULT_VAULT_RULES, deadline: 1 });
    expect(result.stopped?.reason).toBe('no-key');
    expect(h.calls.size).toBe(1);
  });

  it('stops at the deadline and the next run resumes from what is still due', async () => {
    const h = harness({ count: 10, clockStep: 1 });
    const first = await runIdeaScores({ ports: h.ports, rules: DEFAULT_VAULT_RULES, deadline: 5 });
    expect(first.stopped?.reason).toBe('time');
    expect(first.scored).toBeGreaterThan(0);
    expect(first.scored).toBeLessThan(10);
    const second = await runIdeaScores({ ports: h.ports, rules: DEFAULT_VAULT_RULES, deadline: Number.MAX_SAFE_INTEGER });
    expect(first.scored + second.scored).toBe(10);
    expect(second.caughtUp).toBe(true);
  });
});

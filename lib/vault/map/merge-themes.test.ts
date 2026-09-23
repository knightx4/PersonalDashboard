import { describe, expect, it } from 'vitest';
import { EMPTY_USAGE, type SpendReport } from '@/lib/core/spend/pricing';
import {
  parseVerdicts,
  proposalRow,
  renderPairs,
  runThemeMerges,
  survivorOf,
  type JudgeOutcome,
  type MergeProposalRow,
  type ThemeMergePorts,
  type ThemePair,
} from '@/lib/vault/map/merge-themes';

/**
 * The pass, not the SQL. obsidian.theme_merge_candidates was run against the
 * live map when migrations-vault/0007 was applied.
 */

function pair(
  aId: string,
  bId: string,
  options: Partial<Pick<ThemePair, 'userId' | 'similarity' | 'trigram'>> & {
    aNotes?: number;
    bNotes?: number;
  } = {},
): ThemePair {
  return {
    userId: options.userId ?? 'user-1',
    a: { id: aId, name: `Theme ${aId}`, about: `what ${aId} covers`, notes: options.aNotes ?? 1 },
    b: { id: bId, name: `Theme ${bId}`, about: `what ${bId} covers`, notes: options.bNotes ?? 1 },
    similarity: options.similarity === undefined ? 0.8 : options.similarity,
    trigram: options.trigram === undefined ? null : options.trigram,
  };
}

describe('renderPairs', () => {
  it('numbers pairs from 1 and shows each side with its note count', () => {
    const text = renderPairs([pair('a', 'b', { aNotes: 3 }), pair('c', 'd')]);
    expect(text).toBe(
      [
        'Pair 1',
        'A: "Theme a" (3 notes). what a covers',
        'B: "Theme b" (1 note). what b covers',
        '',
        'Pair 2',
        'A: "Theme c" (1 note). what c covers',
        'B: "Theme d" (1 note). what d covers',
      ].join('\n'),
    );
  });
});

describe('parseVerdicts', () => {
  it('keys verdicts back to the pairs sent, from 0', () => {
    const verdicts = parseVerdicts(
      {
        verdicts: [
          { pair: 1, same: true, name: ' Urbanism ', reason: 'Both about cities.', confidence: 0.9 },
          { pair: 2, same: false, name: 'ignored', reason: 'Different fields.', confidence: 0.7 },
        ],
      },
      2,
    );
    expect(verdicts).toEqual([
      { pair: 0, same: true, name: 'Urbanism', reason: 'Both about cities.', confidence: 0.9 },
      { pair: 1, same: false, name: null, reason: 'Different fields.', confidence: 0.7 },
    ]);
  });

  it('drops a pair not sent, a repeat, a malformed entry and an empty reason', () => {
    const verdicts = parseVerdicts(
      {
        verdicts: [
          { pair: 0, same: true, reason: 'out of range', confidence: 1 },
          { pair: 3, same: true, reason: 'out of range', confidence: 1 },
          { pair: 1, same: false, reason: 'first', confidence: 0.5 },
          { pair: 1, same: true, reason: 'second', confidence: 0.5 },
          { pair: 2, same: 'yes', reason: 'malformed', confidence: 0.5 },
          { pair: 2, same: true, reason: '  ', confidence: 0.5 },
        ],
      },
      2,
    );
    expect(verdicts.map((v) => [v.pair, v.reason])).toEqual([[0, 'first']]);
  });

  it('clamps confidence into 0 to 1 and reads a reply with no verdicts as none', () => {
    const [high] = parseVerdicts({ verdicts: [{ pair: 1, same: false, reason: 'r', confidence: 4 }] }, 1);
    const [low] = parseVerdicts({ verdicts: [{ pair: 1, same: false, reason: 'r', confidence: -1 }] }, 1);
    expect([high.confidence, low.confidence]).toEqual([1, 0]);
    expect(parseVerdicts({}, 1)).toEqual([]);
    expect(parseVerdicts(null, 1)).toEqual([]);
  });
});

describe('survivorOf', () => {
  it('keeps the side whose name the model chose, whatever its size', () => {
    const p = pair('a', 'b', { aNotes: 1, bNotes: 9 });
    expect(survivorOf(p, 'theme A').id).toBe('a');
    expect(survivorOf(p, 'Theme b').id).toBe('b');
  });

  it('keeps the side with more notes when the name is new, and A on a tie', () => {
    expect(survivorOf(pair('a', 'b', { aNotes: 1, bNotes: 4 }), 'Cities').id).toBe('b');
    expect(survivorOf(pair('a', 'b', { aNotes: 2, bNotes: 2 }), null).id).toBe('a');
  });
});

describe('proposalRow', () => {
  it('puts the smaller id first and names the survivor for a same verdict', () => {
    const row = proposalRow(
      pair('z', 'm', { aNotes: 1, bNotes: 5, trigram: 0.6 }),
      { pair: 0, same: true, name: null, reason: 'One subject.', confidence: 0.8 },
      'claude-haiku-4-5',
    );
    expect(row).toMatchObject({
      a_id: 'm',
      b_id: 'z',
      a_name: 'Theme m',
      b_name: 'Theme z',
      source: 'both',
      verdict: 'same',
      survivor_id: 'm',
      survivor_name: 'Theme m',
      reason: 'One subject.',
    });
  });

  it('names no survivor for a different verdict, and says which search found it', () => {
    const row = proposalRow(
      pair('a', 'b', { similarity: null, trigram: 0.7 }),
      { pair: 0, same: false, name: null, reason: 'Two fields.', confidence: 0.6 },
      'claude-haiku-4-5',
    );
    expect(row).toMatchObject({
      verdict: 'different',
      survivor_id: null,
      survivor_name: null,
      source: 'trigram',
    });
    expect(
      proposalRow(pair('a', 'b'), { pair: 0, same: false, name: null, reason: 'r', confidence: 0 }, 'm')
        .source,
    ).toBe('embedding');
  });
});

describe('runThemeMerges', () => {
  function fakeMap(
    pairs: ThemePair[],
    judge: (batch: ThemePair[]) => JudgeOutcome = (batch) => ({
      ok: true,
      model: 'claude-haiku-4-5',
      verdicts: batch.map((_, index) => ({
        pair: index,
        same: index % 2 === 0,
        name: null,
        reason: 'judged',
        confidence: 0.9,
      })),
    }),
  ) {
    const stored: MergeProposalRow[] = [];
    const batches: string[][] = [];
    const spent: { userId: string; report: SpendReport }[] = [];
    const judged = (p: ThemePair) =>
      stored.some((row) => row.a_id === [p.a.id, p.b.id].sort()[0] && row.b_id === [p.a.id, p.b.id].sort()[1]);

    const ports: ThemeMergePorts = {
      async candidates(limit) {
        return pairs.filter((p) => !judged(p)).slice(0, limit);
      },
      async judge(batch, onSpend) {
        batches.push(batch.map((p) => `${p.userId}:${p.a.id}-${p.b.id}`));
        onSpend({ model: 'claude-haiku-4-5', usage: EMPTY_USAGE });
        return judge(batch);
      },
      async store(rows) {
        stored.push(...rows);
        return rows.length;
      },
      async ledger(userId, report) {
        spent.push({ userId, report });
      },
    };
    return { ports, stored, batches, spent };
  }

  it('judges every pair in batches and writes one proposal each', async () => {
    const pairs = Array.from({ length: 5 }, (_, i) => pair(`a${i}`, `b${i}`));
    const map = fakeMap(pairs);
    const result = await runThemeMerges(map.ports, { batch: 2 });

    expect(map.batches.map((b) => b.length)).toEqual([2, 2, 1]);
    expect(map.stored).toHaveLength(5);
    expect(result).toEqual({ proposed: 5, same: 3, calls: 3, stopped: null });
    expect(map.spent).toHaveLength(3);
  });

  it('sends one owner per call and charges that owner', async () => {
    const map = fakeMap([
      pair('a', 'b', { userId: 'user-1' }),
      pair('c', 'd', { userId: 'user-2' }),
    ]);
    await runThemeMerges(map.ports, { batch: 20 });

    expect(map.batches).toEqual([['user-1:a-b'], ['user-2:c-d']]);
    expect(map.spent.map((s) => s.userId)).toEqual(['user-1', 'user-2']);
  });

  it('stops at the deadline before starting another call', async () => {
    let clock = 0;
    const map = fakeMap([pair('a', 'b'), pair('c', 'd')]);
    const result = await runThemeMerges(
      { ...map.ports, judge: async (batch, onSpend) => ((clock = 100), map.ports.judge(batch, onSpend)) },
      { batch: 1, deadline: 50, now: () => clock },
    );
    expect(result.calls).toBe(1);
    expect(result.stopped?.reason).toBe('time');
  });

  it('stops on a failed call without writing anything', async () => {
    const map = fakeMap([pair('a', 'b')], () => ({ ok: false, reason: 'failed', detail: 'credit balance is too low' }));
    const result = await runThemeMerges(map.ports);
    expect(map.stored).toEqual([]);
    expect(result.stopped).toEqual({ reason: 'failed', detail: 'credit balance is too low' });
    expect(map.spent).toHaveLength(1);
  });

  it('stops when the model answers none of the pairs rather than asking forever', async () => {
    const map = fakeMap([pair('a', 'b')], () => ({ ok: true, model: 'm', verdicts: [] }));
    const result = await runThemeMerges(map.ports);
    expect(result.calls).toBe(1);
    expect(result.stopped?.reason).toBe('unanswered');
  });

  it('asks nothing when every pair has been judged', async () => {
    const map = fakeMap([]);
    const result = await runThemeMerges(map.ports);
    expect(result).toEqual({ proposed: 0, same: 0, calls: 0, stopped: null });
  });
});

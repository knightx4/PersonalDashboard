import { describe, expect, it } from 'vitest';
import { EMPTY_USAGE } from '@/lib/core/spend/pricing';
import { NODE_RULE } from '@/lib/learn/graph/position-prompt';
import type { MergeProposalRow } from '@/lib/vault/map/merge-pass';
import {
  POSITION_SYSTEM,
  positionPairFrom,
  positionProposalRow,
  renderPositionPairs,
  runPositionMerges,
  type PositionMergePorts,
  type PositionPair,
} from '@/lib/vault/map/merge-positions';

/**
 * The pass, not the SQL. obsidian.position_merge_candidates was run against
 * the live map when migrations-vault/0008 was applied: 60 name pairs across
 * notes, and a pair given one vector came back from the embedding search too.
 * The loop itself is merge-pass.ts's and is covered in merge-themes.test.ts.
 */

function pair(
  aId: string,
  bId: string,
  options: Partial<Pick<PositionPair, 'userId' | 'similarity' | 'trigram'>> & {
    aNotes?: number;
    bNotes?: number;
  } = {},
): PositionPair {
  return {
    userId: options.userId ?? 'user-1',
    a: { id: aId, name: `Name ${aId}`, statement: `Statement ${aId}.`, kind: 'claim', notes: options.aNotes ?? 1 },
    b: { id: bId, name: `Name ${bId}`, statement: `Statement ${bId}.`, kind: 'position', notes: options.bNotes ?? 1 },
    similarity: options.similarity === undefined ? null : options.similarity,
    trigram: options.trigram === undefined ? 0.6 : options.trigram,
  };
}

describe('POSITION_SYSTEM', () => {
  it('judges against the node test every extraction uses', () => {
    expect(POSITION_SYSTEM).toContain(NODE_RULE);
  });
});

describe('renderPositionPairs', () => {
  it('numbers pairs from 1 and shows each side with its name, kind and statement', () => {
    expect(renderPositionPairs([pair('a', 'b'), pair('c', 'd')])).toBe(
      [
        'Pair 1',
        'A: "Name a" (claim). Statement a.',
        'B: "Name b" (position). Statement b.',
        '',
        'Pair 2',
        'A: "Name c" (claim). Statement c.',
        'B: "Name d" (position). Statement d.',
      ].join('\n'),
    );
  });
});

describe('positionPairFrom', () => {
  it('reads one row of the candidate function', () => {
    expect(
      positionPairFrom({
        user_id: 'u',
        a_id: '1',
        a_name: 'Transportation as means not end',
        a_statement: 'Transport serves access.',
        a_kind: 'position',
        a_notes: 1,
        b_id: '2',
        b_name: 'Transportation as means not end',
        b_statement: 'Travel is a means.',
        b_kind: 'claim',
        b_notes: 2,
        similarity: null,
        trigram: 1,
      }),
    ).toEqual({
      userId: 'u',
      a: { id: '1', name: 'Transportation as means not end', statement: 'Transport serves access.', kind: 'position', notes: 1 },
      b: { id: '2', name: 'Transportation as means not end', statement: 'Travel is a means.', kind: 'claim', notes: 2 },
      similarity: null,
      trigram: 1,
    });
  });
});

describe('positionProposalRow', () => {
  it('writes kind position, smaller id first, with the survivor the model named', () => {
    const row = positionProposalRow(
      pair('z', 'b', { similarity: 0.82 }),
      { pair: 0, same: true, name: 'Name b', reason: 'One claim.', confidence: 0.9 },
      'claude-haiku-4-5',
    );
    expect(row).toMatchObject({
      kind: 'position',
      a_id: 'b',
      b_id: 'z',
      a_name: 'Name b',
      b_name: 'Name z',
      source: 'both',
      verdict: 'same',
      survivor_id: 'b',
      survivor_name: 'Name b',
    });
  });

  it('keeps the side from more notes when the model coins a name', () => {
    const row = positionProposalRow(
      pair('a', 'b', { bNotes: 3 }),
      { pair: 0, same: true, name: 'A new name', reason: 'One claim.', confidence: 0.8 },
      'm',
    );
    expect(row.survivor_id).toBe('b');
    expect(row.survivor_name).toBe('A new name');
    expect(row.source).toBe('trigram');
  });
});

describe('runPositionMerges', () => {
  it('writes a position proposal for every pair and nothing else', async () => {
    const stored: MergeProposalRow[] = [];
    const pairs = [pair('a', 'b'), pair('c', 'd'), pair('e', 'f')];
    const ports: PositionMergePorts = {
      async candidates(limit) {
        return pairs.filter((p) => !stored.some((row) => row.a_id === p.a.id)).slice(0, limit);
      },
      async judge(batch, onSpend) {
        onSpend({ model: 'claude-haiku-4-5', usage: EMPTY_USAGE });
        return {
          ok: true,
          model: 'claude-haiku-4-5',
          verdicts: batch.map((_, index) => ({
            pair: index,
            same: index === 0,
            name: null,
            reason: 'judged',
            confidence: 0.7,
          })),
        };
      },
      async store(rows) {
        stored.push(...rows);
        return rows.length;
      },
    };

    const result = await runPositionMerges(ports, { batch: 2 });

    expect(result).toEqual({ proposed: 3, same: 2, calls: 2, stopped: null });
    expect(stored.map((row) => row.kind)).toEqual(['position', 'position', 'position']);
  });
});

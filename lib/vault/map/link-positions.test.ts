import { describe, expect, it } from 'vitest';
import { EMPTY_USAGE } from '@/lib/core/spend/pricing';
import { MAP_EDGE_RULE, NODE_RULE } from '@/lib/learn/graph/position-prompt';
import {
  LINK_SYSTEM,
  linkPairFrom,
  linkRecordRow,
  parseLinkVerdicts,
  renderLinkPairs,
  runLinkPass,
  type LinkPair,
  type LinkPassPorts,
  type LinkRecordRow,
} from '@/lib/vault/map/link-positions';

/**
 * The pass, not the SQL. obsidian.position_link_candidates and
 * record_position_links (migrations-vault/0014) were run against the live map
 * when the migration was applied: 13,267 pairs from 5,062 embedded positions,
 * read back in under a second.
 */

function pair(aId: string, bId: string, userId = 'user-1'): LinkPair {
  return {
    userId,
    a: { id: aId, name: `Name ${aId}`, statement: `Statement ${aId}.`, kind: 'claim' },
    b: { id: bId, name: `Name ${bId}`, statement: `Statement ${bId}.`, kind: 'position' },
    similarity: 0.7,
  };
}

describe('LINK_SYSTEM', () => {
  it('judges against the node test and the six edge types every extraction uses', () => {
    expect(LINK_SYSTEM).toContain(NODE_RULE);
    expect(LINK_SYSTEM).toContain(MAP_EDGE_RULE);
  });
});

describe('renderLinkPairs', () => {
  it('numbers pairs from 1 and shows each side with its name, kind and statement', () => {
    expect(renderLinkPairs([pair('a', 'b')])).toBe(
      ['Pair 1', 'A: "Name a" (claim). Statement a.', 'B: "Name b" (position). Statement b.'].join(
        '\n',
      ),
    );
  });
});

describe('parseLinkVerdicts', () => {
  it('keeps edges with a direction and nones without one, numbered from 0', () => {
    expect(
      parseLinkVerdicts(
        {
          verdicts: [
            { pair: 1, relation: 'supports', from: 'B', reason: ' B is why A holds. ', confidence: 0.8 },
            { pair: 2, relation: 'none', from: 'A', reason: 'Only the subject is shared.', confidence: 2 },
          ],
        },
        2,
      ),
    ).toEqual([
      { pair: 0, relation: 'supports', from: 'B', reason: 'B is why A holds.', confidence: 0.8 },
      { pair: 1, relation: 'none', from: null, reason: 'Only the subject is shared.', confidence: 1 },
    ]);
  });

  it('drops an edge with no direction, an unknown relation, a repeat, an empty reason and a pair not sent', () => {
    expect(
      parseLinkVerdicts(
        {
          verdicts: [
            { pair: 1, relation: 'contradicts', reason: 'No side given.', confidence: 0.5 },
            { pair: 1, relation: 'mentions', from: 'A', reason: 'Closed type.', confidence: 0.5 },
            { pair: 2, relation: 'qualifies', from: 'A', reason: 'A bounds B.', confidence: 0.5 },
            { pair: 2, relation: 'supports', from: 'A', reason: 'Second answer.', confidence: 0.5 },
            { pair: 3, relation: 'none', reason: '  ', confidence: 0.5 },
            { pair: 4, relation: 'none', reason: 'Not sent.', confidence: 0.5 },
          ],
        },
        3,
      ).map((v) => [v.pair, v.relation]),
    ).toEqual([[1, 'qualifies']]);
  });

  it('reads nothing from a reply of the wrong shape', () => {
    expect(parseLinkVerdicts({ answers: [] }, 3)).toEqual([]);
  });
});

describe('linkRecordRow', () => {
  it('stores the smaller id first and keeps the direction by id', () => {
    const row = linkRecordRow(
      pair('z', 'a'),
      { pair: 0, relation: 'supports', from: 'A', reason: 'Z is why A holds.', confidence: 0.7 },
      'claude-haiku-4-5',
    );
    expect(row).toEqual({
      a_id: 'a',
      b_id: 'z',
      relation: 'supports',
      from_id: 'z',
      reason: 'Z is why A holds.',
      confidence: 0.7,
      model: 'claude-haiku-4-5',
    });
  });

  it('gives a none no direction', () => {
    const row = linkRecordRow(
      pair('a', 'b'),
      { pair: 0, relation: 'none', from: null, reason: 'Unrelated.', confidence: 0.9 },
      'm',
    );
    expect(row.from_id).toBeNull();
  });
});

describe('linkPairFrom', () => {
  it('reads one candidate row', () => {
    expect(
      linkPairFrom({
        user_id: 'u',
        a_id: 'a',
        a_name: 'A',
        a_statement: 'A holds.',
        a_kind: 'claim',
        b_id: 'b',
        b_name: 'B',
        b_statement: 'B holds.',
        b_kind: 'frame',
        similarity: 0.71,
      }),
    ).toEqual({
      userId: 'u',
      a: { id: 'a', name: 'A', statement: 'A holds.', kind: 'claim' },
      b: { id: 'b', name: 'B', statement: 'B holds.', kind: 'frame' },
      similarity: 0.71,
    });
  });
});

function ports(batches: LinkPair[][], overrides: Partial<LinkPassPorts> = {}) {
  const recorded: LinkRecordRow[][] = [];
  const spent: string[] = [];
  let read = 0;
  const value: LinkPassPorts = {
    candidates: async () => batches[read++] ?? [],
    judge: async (pairs, onSpend) => {
      onSpend({ model: 'claude-haiku-4-5', usage: EMPTY_USAGE });
      return {
        ok: true,
        model: 'claude-haiku-4-5',
        verdicts: pairs.map((_, index) => ({
          pair: index,
          relation: index === 0 ? 'supports' : 'none',
          from: index === 0 ? 'A' : null,
          reason: 'Because.',
          confidence: 0.6,
        })),
      };
    },
    record: async (rows) => {
      recorded.push(rows);
      return { recorded: rows.length, edges: rows.filter((r) => r.relation !== 'none').length };
    },
    ledger: async (owner) => {
      spent.push(owner);
    },
    ...overrides,
  };
  return { value, recorded, spent };
}

describe('runLinkPass', () => {
  it('judges batches until no pairs are left and counts the edges written', async () => {
    const { value, recorded, spent } = ports([[pair('a', 'b'), pair('c', 'd')], [pair('e', 'f')]]);
    const result = await runLinkPass(value);
    expect(result).toEqual({ judged: 3, edges: 2, calls: 2, stopped: null });
    expect(recorded.map((rows) => rows.length)).toEqual([2, 1]);
    expect(spent).toEqual(['user-1', 'user-1']);
  });

  it('sends one owner per call', async () => {
    const judged: string[][] = [];
    const { value } = ports([[pair('a', 'b', 'u1'), pair('c', 'd', 'u2')]], {
      judge: async (pairs) => {
        judged.push(pairs.map((p) => p.userId));
        return { ok: false, reason: 'failed', detail: 'stop here' };
      },
    });
    const result = await runLinkPass(value);
    expect(judged).toEqual([['u1']]);
    expect(result.stopped).toEqual({ reason: 'failed', detail: 'stop here' });
  });

  it('starts no call after the deadline', async () => {
    const { value } = ports([[pair('a', 'b')]]);
    const result = await runLinkPass(value, { deadline: 100, now: () => 100 });
    expect(result).toEqual({
      judged: 0,
      edges: 0,
      calls: 0,
      stopped: { reason: 'time', detail: 'ran out of time before reading pairs' },
    });
  });

  it('stops when a call records nothing, so an unanswered pair is not sent forever', async () => {
    const { value } = ports([[pair('a', 'b')], [pair('a', 'b')]], {
      judge: async () => ({ ok: true, model: 'm', verdicts: [] }),
    });
    const result = await runLinkPass(value);
    expect(result.calls).toBe(1);
    expect(result.stopped?.reason).toBe('unanswered');
  });
});

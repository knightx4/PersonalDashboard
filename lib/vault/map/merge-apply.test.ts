import { describe, expect, it, vi } from 'vitest';
import {
  applyMergeProposals,
  mergeInputFromProposal,
  mergeMapRows,
  undoMapMerge,
} from './merge-apply';

/**
 * The TypeScript side of merging. What the database does with a merge is
 * tests/vault-map-merge.test.ts; this checks what is sent and how a refusal
 * comes back.
 */

function client(reply: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(reply);
  return { supabase: { rpc } as never, rpc };
}

const SUMMARY = {
  mergeId: 'm1',
  kind: 'theme',
  survivorId: 's',
  absorbedId: 'a',
  proposalId: 'p1',
  mergedAt: '2026-09-23T00:00:00Z',
  undoneAt: null,
  moved: { theme_notes: 2 },
  removed: {},
};

describe('mergeMapRows', () => {
  it('calls the function for the kind with the survivor, the absorbed side and the name', async () => {
    const { supabase, rpc } = client({ data: SUMMARY, error: null });
    const result = await mergeMapRows(supabase, 'theme', {
      survivorId: 's',
      absorbedId: 'a',
      name: 'Urbanism',
      proposalId: 'p1',
    });
    expect(result).toEqual({ ok: true, ...SUMMARY });
    expect(rpc).toHaveBeenCalledWith('merge_themes', {
      p_survivor_id: 's',
      p_absorbed_id: 'a',
      p_name: 'Urbanism',
      p_proposal_id: 'p1',
    });

    await mergeMapRows(supabase, 'position', { survivorId: 's', absorbedId: 'a' });
    expect(rpc).toHaveBeenLastCalledWith('merge_positions', {
      p_survivor_id: 's',
      p_absorbed_id: 'a',
      p_name: null,
      p_proposal_id: null,
    });
  });

  it('names the refusal from the function', async () => {
    const taken = client({
      data: null,
      error: {
        code: 'P0001',
        message: 'Another theme is already called "Money".',
        details: 'name-taken',
      },
    });
    expect(
      await mergeMapRows(taken.supabase, 'theme', { survivorId: 's', absorbedId: 'a' }),
    ).toMatchObject({
      ok: false,
      reason: 'name-taken',
    });

    const gone = client({
      data: null,
      error: { code: 'P0002', message: 'One of the two is not in the map.' },
    });
    expect(
      await mergeMapRows(gone.supabase, 'theme', { survivorId: 's', absorbedId: 'a' }),
    ).toMatchObject({
      ok: false,
      reason: 'gone',
    });
  });
});

describe('undoMapMerge', () => {
  it('sends the merge id and says when the survivor has been merged away since', async () => {
    const { supabase, rpc } = client({
      data: null,
      error: { code: 'P0001', message: 'Undo that first.', details: 'survivor-gone' },
    });
    expect(await undoMapMerge(supabase, 'm1')).toMatchObject({
      ok: false,
      reason: 'survivor-gone',
    });
    expect(rpc).toHaveBeenCalledWith('undo_map_merge', { p_merge_id: 'm1' });
  });
});

describe('mergeInputFromProposal', () => {
  const base = { id: 'p1', kind: 'theme' as const, a_id: 'a', b_id: 'b' };

  it('keeps the side the model chose and absorbs the other', () => {
    expect(
      mergeInputFromProposal({
        ...base,
        verdict: 'same',
        survivor_id: 'b',
        survivor_name: 'Cities',
      }),
    ).toEqual({ survivorId: 'b', absorbedId: 'a', name: 'Cities', proposalId: 'p1' });
    expect(
      mergeInputFromProposal({
        ...base,
        verdict: 'same',
        survivor_id: 'a',
        survivor_name: 'Cities',
      }),
    ).toMatchObject({ survivorId: 'a', absorbedId: 'b' });
  });

  it('has nothing to apply for a different verdict', () => {
    expect(
      mergeInputFromProposal({
        ...base,
        verdict: 'different',
        survivor_id: null,
        survivor_name: null,
      }),
    ).toBeNull();
  });
});

describe('applyMergeProposals', () => {
  const reply = (counts: Partial<Record<string, number>>, remaining: number) => ({
    data: { merged: 0, joined: 0, undone: 0, gone: 0, failed: 0, ...counts, kind: 'theme', remaining },
    error: null,
  });

  it('calls the database until nothing is left, adding up the outcomes', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce(reply({ merged: 150, joined: 20 }, 30))
      .mockResolvedValueOnce(reply({ merged: 25, undone: 5 }, 0));
    const result = await applyMergeProposals({ rpc } as never, 'theme', {
      userId: null,
      deadline: 100_000,
      now: () => 0,
    });
    expect(result).toEqual({
      kind: 'theme',
      counts: { merged: 175, joined: 20, undone: 5, gone: 0, failed: 0 },
      remaining: 0,
      stopped: null,
    });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith('apply_merge_proposals', {
      p_kind: 'theme',
      p_user_id: null,
      p_limit: 500,
      p_budget_ms: 4000,
    });
  });

  it('stops for time with proposals left, and gives a short call only the time there is', async () => {
    let clock = 0;
    const rpc = vi.fn().mockImplementation(async () => {
      clock += 2_000;
      return reply({ merged: 80 }, 100);
    });
    const result = await applyMergeProposals({ rpc } as never, 'position', {
      userId: 'u1',
      deadline: 2_400,
      now: () => clock,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_kind: 'position', p_user_id: 'u1', p_budget_ms: 1_900 });
    expect(result.stopped).toEqual({ reason: 'time' });
    expect(result.remaining).toBe(100);
  });

  it('reports a failed call instead of throwing', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'canceling statement' } });
    const result = await applyMergeProposals({ rpc } as never, 'theme', {
      userId: null,
      deadline: 100_000,
      now: () => 0,
    });
    expect(result.stopped).toEqual({ reason: 'error', detail: 'canceling statement' });
  });

  it('does not spin when a call looks at nothing', async () => {
    const rpc = vi.fn().mockResolvedValue(reply({}, 40));
    const result = await applyMergeProposals({ rpc } as never, 'theme', {
      userId: null,
      deadline: 100_000,
      now: () => 0,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(result.stopped).toEqual({ reason: 'time' });
  });
});

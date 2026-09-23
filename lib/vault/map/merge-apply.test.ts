import { describe, expect, it, vi } from 'vitest';
import { mergeInputFromProposal, mergeMapRows, undoMapMerge } from './merge-apply';

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

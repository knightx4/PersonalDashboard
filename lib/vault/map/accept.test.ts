import { describe, expect, it, vi } from 'vitest';
import { acceptNoteMap } from './accept';
import type { NoteMap } from './proposal';

/**
 * The TypeScript side of accepting. What the database does with the map is
 * tests/vault-accept-map.test.ts; this checks what is sent and how a refusal
 * comes back.
 */

const MAP: NoteMap = {
  themes: [{ key: 't0', name: 'Urbanism', about: 'Cities.', basis: 'Read in the section "One".' }],
  positions: [
    {
      key: 'p0',
      name: 'Parking harms cities',
      statement: 'Surface parking harms cities.',
      kind: 'claim',
      stance: 'held',
      basis: 'Stated in the note.',
      quote: 'Surface parking is bad.',
      themes: ['t0'],
    },
  ],
  edges: [],
};

function client(reply: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(reply);
  return { supabase: { rpc } as never, rpc };
}

describe('acceptNoteMap', () => {
  it('sends the map to accept_note_map with the version that was read', async () => {
    const { supabase, rpc } = client({
      data: { themes: 1, positions: 1, newPositions: 1, edges: 0 },
      error: null,
    });
    const result = await acceptNoteMap(supabase, { noteId: 'n1', blobSha: 'sha-1', map: MAP });
    expect(result).toEqual({ ok: true, themes: 1, positions: 1, newPositions: 1, edges: 0 });
    expect(rpc).toHaveBeenCalledWith('accept_note_map', {
      p_note_id: 'n1',
      p_blob_sha: 'sha-1',
      p_map: MAP,
    });
  });

  it('says so when the note changed since it was read', async () => {
    const { supabase } = client({
      data: null,
      error: {
        code: 'P0001',
        message: 'The note has changed since it was read.',
        details: 'stale-note',
      },
    });
    const result = await acceptNoteMap(supabase, { noteId: 'n1', blobSha: 'old', map: MAP });
    expect(result).toMatchObject({ ok: false, reason: 'stale-note' });
  });

  it('writes nothing when nothing was ticked', async () => {
    const { supabase, rpc } = client({ data: null, error: null });
    const result = await acceptNoteMap(supabase, {
      noteId: 'n1',
      blobSha: 'sha-1',
      map: { themes: [], positions: [], edges: [] },
    });
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    expect(rpc).not.toHaveBeenCalled();
  });
});

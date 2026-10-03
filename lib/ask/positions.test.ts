import { describe, expect, it } from 'vitest';
import type { AskContext } from './db';
import { notePositionsLookup, type NotePositionsPorts } from './positions';
import { executeAskTool } from './tools';
import { dashToolsOf, ASK_DASH_TOOLS } from '@/lib/dash/registry';

/**
 * note_positions, Maya's retrieval as a lookup every Dash surface has (plan
 * #1479), over fake reads.
 */

const notes = {
  self: { id: 'n-self', path: 'Essays/Self.md', title: 'Against finding yourself', body: 'You become yourself in action.' },
  road: { id: 'n-road', path: 'Bulk/Road.md', title: 'Life is a road', body: 'Act as the discovered self.' },
};

function ports(): NotePositionsPorts {
  const byId = new Map(Object.values(notes).map((n) => [n.id, n]));
  return {
    find: async (ref) => {
      const note = Object.values(notes).find((n) => n.path === ref || n.id === ref);
      return note ? { id: note.id, path: note.path } : null;
    },
    paths: async (ids) => new Map(ids.flatMap((id) => (byId.get(id) ? [[id, byId.get(id)!.path] as [string, string]] : []))),
    note: async (id) => byId.get(id) ?? null,
    vector: async () => ({ vector: [0.1], model: 'voyage-4-lite' }),
    nearest: async () => [{ note_id: 'n-road', path: 'Bulk/Road.md', title: 'Life is a road', similarity: 0.8 }],
    notes: async (ids) => ids.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : [])),
    positionsOfNotes: async () => [
      { position_id: 'p-made', note_id: 'n-self' },
      { position_id: 'p-found', note_id: 'n-road' },
    ],
    positionsSharingThemes: async () => [],
    positions: async () => [
      { id: 'p-made', name: 'Made in action', statement: 'The self is made by acting.', stance: 'held', centrality: 0.4, sources: [{ note_id: 'n-self', quote: 'You become yourself' }] },
      { id: 'p-found', name: 'Found then expressed', statement: 'The self is found, then acted out.', stance: 'held', centrality: 0.9, sources: [{ note_id: 'n-road', quote: 'discovered self' }] },
    ],
    conflicts: async () => [{ leftId: 'p-made', rightId: 'p-found', crux: 'Which comes first', origin: 'tension' }],
  };
}

const ctx = { userId: 'u1', today: '2026-10-03', enabledModules: ['vault'], searchSources: [] } as unknown as AskContext;

describe('note_positions', () => {
  it('lists the nearby notes and the positions bearing on the note, and which conflict', async () => {
    const result = await notePositionsLookup(ctx, { ref: 'Essays/Self.md' }, ports());
    if (!result.ok) throw new Error(result.error);

    expect(result.rows.map((row) => [row.table, row.ref])).toEqual([
      ['obsidian.notes', 'Bulk/Road.md'],
      ['obsidian.positions', 'p-made'],
      ['obsidian.positions', 'p-found'],
    ]);
    expect(result.rows[0]!.href).toBe('/vault/n/Bulk/Road.md');
    expect(result.rows[1]!.detail).toMatchObject({ label: 'P1', reached: 'from this note' });
    expect(result.totals).toMatchObject({ conflicts: ['P1 and P2: Which comes first'] });
  });

  it('says so for a note it cannot find, and asks for a ref when given none', async () => {
    expect(await notePositionsLookup(ctx, { ref: 'Nowhere.md' }, ports())).toEqual({
      ok: false,
      error: 'No note in the vault has that ref.',
    });
    await expect(notePositionsLookup(ctx, {}, ports())).rejects.toThrow(/ref/);
  });

  it('is a lookup on every surface, Ask included, and needs the vault on', async () => {
    expect(dashToolsOf('lookup').map((tool) => tool.name)).toContain('note_positions');
    expect(ASK_DASH_TOOLS.map((tool) => tool.name)).toContain('note_positions');
    const off = await executeAskTool('note_positions', { ref: 'Essays/Self.md' }, { ...ctx, enabledModules: [] });
    expect(off).toEqual({ ok: false, error: 'The Vault workspace is switched off, so it cannot be read.' });
  });
});

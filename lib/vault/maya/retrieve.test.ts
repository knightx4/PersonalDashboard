import { describe, expect, it } from 'vitest';
import { gatherMaterial, MAYA_RELATED_NOTES, type MayaConflict, type MayaRetrievePorts, type RawNote, type RawPosition } from './retrieve';

/** The assembly over fake reads: what is kept, what is left out, and in what order. */

const notes: Record<string, RawNote> = {
  a: { id: 'a', path: 'Against.md', title: 'Against "Finding Yourself"', body: 'You become yourself in action.', blob_sha: 'sha-a' },
  road: { id: 'road', path: 'Bulk/Road.md', title: 'Life is a road to the self', body: 'Act as the discovered self.' },
  intro: { id: 'intro', path: 'Bulk/Intro.md', title: 'On Introspection', body: 'Come out of the maze.' },
  diary: { id: 'diary', path: 'Me/Diary.md', title: 'Diary', body: 'A journal entry about the self.' },
  keyed: { id: 'keyed', path: 'Keys.md', title: 'Keys', body: 'token sk-ant-123' },
  weak: { id: 'weak', path: 'Weak.md', title: 'Weak', body: 'Loosely related.' },
};

const positions: Record<string, RawPosition> = {
  own: { id: 'own', name: 'Made in action', statement: 's', stance: 'held', centrality: 0.2, sources: [{ note_id: 'a', quote: 'You become yourself' }] },
  essay: { id: 'essay', name: 'Found then expressed', statement: 's', stance: 'held', centrality: 0.9, sources: [{ note_id: 'road', quote: 'discovered self' }] },
  themed: { id: 'themed', name: 'Balance', statement: 's', stance: 'held', centrality: 0.5, sources: [{ note_id: 'far', quote: 'balance' }] },
  journal: { id: 'journal', name: 'From the diary', statement: 's', stance: 'held', centrality: 1, sources: [{ note_id: 'diary', quote: 'journal entry' }] },
};

function ports(overrides: Partial<MayaRetrievePorts> = {}, conflicts: MayaConflict[] = []): MayaRetrievePorts {
  const all: Record<string, RawNote> = { ...notes, far: { id: 'far', path: 'Far.md', title: 'Far', body: 'Keep a balance.' } };
  return {
    note: async (id) => all[id] ?? null,
    vector: async () => ({ vector: [0.1], model: 'voyage-4-lite' }),
    nearest: async () => [
      { note_id: 'intro', path: 'Bulk/Intro.md', title: 'On Introspection', similarity: 0.77 },
      { note_id: 'diary', path: 'Me/Diary.md', title: 'Diary', similarity: 0.75 },
      { note_id: 'keyed', path: 'Keys.md', title: 'Keys', similarity: 0.7 },
      { note_id: 'road', path: 'Bulk/Road.md', title: 'Life is a road to the self', similarity: 0.67 },
      { note_id: 'weak', path: 'Weak.md', title: 'Weak', similarity: 0.5 },
    ],
    notes: async (ids) => ids.flatMap((id) => (all[id] ? [all[id]!] : [])),
    positionsOfNotes: async (ids) =>
      Object.values(positions).flatMap((p) =>
        p.sources.filter((s) => ids.includes(s.note_id)).map((s) => ({ position_id: p.id, note_id: s.note_id })),
      ),
    positionsSharingThemes: async () => ['themed', 'journal'],
    positions: async (ids) => ids.flatMap((id) => (positions[id] ? [positions[id]!] : [])),
    conflicts: async () => conflicts,
    ...overrides,
  };
}

describe('gatherMaterial', () => {
  it('keeps the readable related notes above the floor, closest first', async () => {
    const out = await gatherMaterial(ports(), 'a');
    if (!out.ok) throw new Error(out.detail);
    expect(out.material.note).toMatchObject({ id: 'a', blobSha: 'sha-a' });
    expect(out.material.related.map((n) => n.id)).toEqual(['intro', 'road']);
    expect(out.material.bodies.has('diary')).toBe(false);
    expect(out.material.bodies.has('keyed')).toBe(false);
    expect(JSON.stringify(out.material)).not.toContain('Bulk/');
  });

  it('orders positions own, related, theme, and drops one read only from a journal', async () => {
    const out = await gatherMaterial(ports(), 'a');
    if (!out.ok) throw new Error(out.detail);
    expect(out.material.positions.map((p) => [p.id, p.via])).toEqual([
      ['own', 'this-note'],
      ['essay', 'related-note'],
      ['themed', 'theme'],
    ]);
    expect(out.material.positions[2]!.quotes).toEqual([{ noteId: 'far', noteTitle: 'Far', quote: 'balance' }]);
    expect(out.material.bodies.get('far')?.body).toBe('Keep a balance.');
  });

  it('keeps only conflicts between positions it kept, one per pair', async () => {
    const out = await gatherMaterial(
      ports({}, [
        { leftId: 'own', rightId: 'essay', crux: null, origin: 'contradicts' },
        { leftId: 'essay', rightId: 'own', crux: 'Which comes first.', origin: 'tension' },
        { leftId: 'own', rightId: 'journal', crux: null, origin: 'contradicts' },
      ]),
      'a',
    );
    if (!out.ok) throw new Error(out.detail);
    expect(out.material.conflicts).toEqual([{ leftId: 'essay', rightId: 'own', crux: 'Which comes first.', origin: 'tension' }]);
  });

  it('refuses a subject note the map may not read, and a missing one', async () => {
    expect(await gatherMaterial(ports(), 'diary')).toMatchObject({ ok: false, reason: 'not-read' });
    expect(await gatherMaterial(ports(), 'keyed')).toMatchObject({ ok: false, reason: 'not-read' });
    expect(await gatherMaterial(ports(), 'nope')).toMatchObject({ ok: false, reason: 'not-found' });
  });

  it('works with no vector: no related notes, still its own positions', async () => {
    const out = await gatherMaterial(ports({ vector: async () => null }), 'a');
    if (!out.ok) throw new Error(out.detail);
    expect(out.material.related).toEqual([]);
    expect(out.material.positions.map((p) => p.id)).toContain('own');
  });

  it('keeps at most MAYA_RELATED_NOTES related notes', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, path: `n${i}.md`, title: `N${i}`, body: 'b' }));
    const out = await gatherMaterial(
      ports({
        nearest: async () => many.map((n) => ({ note_id: n.id, path: n.path, title: n.title, similarity: 0.9 })),
        notes: async (ids) => [...many, notes.a!].filter((n) => ids.includes(n.id)),
      }),
      'a',
    );
    if (!out.ok) throw new Error(out.detail);
    expect(out.material.related).toHaveLength(MAYA_RELATED_NOTES);
  });
});

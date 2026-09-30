import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { whyNotRead } from '@/lib/vault/map/rules';
import { readVector, RELATED_NOTE_MIN_SIMILARITY, type Vectorised } from '@/lib/vault/notes/related';
import { vectorLiteral } from '@/lib/learn/catalogue/embed-sweep';

/**
 * What Maya reads before writing a thought on one note (plan #1284, under
 * #1282).
 *
 * Four things, all the person's own:
 *
 * 1. The notes nearest this one by embedding, at RELATED_NOTE_MIN_SIMILARITY
 *    or above, from obsidian.nearest_notes. The note's stored vector is used,
 *    so nothing is embedded here.
 * 2. The positions the map drew from this note and from those related notes
 *    (position_sources), with their quotes.
 * 3. Positions that share a theme with this note, through theme_notes and
 *    through its own positions' theme_positions, with their quotes.
 * 4. The conflicts among all those positions: open tensions, and position
 *    edges of type 'contradicts'. A synthesis is only allowed on one of these
 *    pairs (verify.ts).
 *
 * A note that whyNotRead refuses (a journal, an excluded folder, a note
 * holding a key) is left out on both sides: it is never the subject, never a
 * related note, and a position whose every quote comes from such notes is
 * dropped with them, since its statement was written from them.
 *
 * Paths are read here for that check and go no further: the material handed
 * to the model carries titles and bodies only.
 */

/** Related notes read in full. */
export const MAYA_RELATED_NOTES = 8;

/** Positions put in front of the model, own and related first, then by centrality. */
export const MAYA_POSITIONS = 16;

/** Quotes shown under one position. */
export const MAYA_QUOTES_PER_POSITION = 2;

export type MayaNote = {
  id: string;
  title: string;
  body: string;
};

export type MayaSubject = MayaNote & {
  /** The version that was read, for maya_messages.note_blob_sha. */
  blobSha: string | null;
};

export type MayaRelatedNote = MayaNote & { similarity: number };

export type MayaQuote = { noteId: string; noteTitle: string; quote: string };

export type MayaPosition = {
  id: string;
  name: string;
  statement: string;
  stance: string;
  /** How it was reached: from this note, from a related note, or through a shared theme. */
  via: 'this-note' | 'related-note' | 'theme';
  quotes: MayaQuote[];
};

export type MayaConflict = {
  leftId: string;
  rightId: string;
  /** What the two disagree on, when a tension names it. */
  crux: string | null;
  origin: 'tension' | 'contradicts';
};

export type MayaMaterial = {
  note: MayaSubject;
  related: MayaRelatedNote[];
  positions: MayaPosition[];
  conflicts: MayaConflict[];
  /**
   * Every readable note body seen, by id, so a quote can be checked against
   * the whole note and not only the part the model was shown.
   */
  bodies: Map<string, MayaNote>;
};

export type RawNote = {
  id: string;
  path: string;
  title: string | null;
  body: string | null;
  blob_sha?: string | null;
};

export type RawPosition = {
  id: string;
  name: string;
  statement: string;
  stance: string;
  centrality: number | null;
  sources: { note_id: string; quote: string }[];
};

type NearestRow = { note_id: string; path: string; title: string | null; similarity: number };

/** The reads retrieval needs, so the assembly can be tested without a database. */
export type MayaRetrievePorts = {
  note(noteId: string): Promise<RawNote | null>;
  vector(noteId: string): Promise<Vectorised | null>;
  nearest(vector: Vectorised, limit: number, exclude: string[]): Promise<NearestRow[]>;
  notes(ids: string[]): Promise<RawNote[]>;
  /** Ids of positions quoting any of these notes. */
  positionsOfNotes(noteIds: string[]): Promise<{ position_id: string; note_id: string }[]>;
  /** Ids of positions under any theme this note or these positions belong to. */
  positionsSharingThemes(noteId: string, positionIds: string[]): Promise<string[]>;
  positions(ids: string[]): Promise<RawPosition[]>;
  conflicts(ids: string[]): Promise<MayaConflict[]>;
};

export type RetrieveResult =
  | { ok: true; material: MayaMaterial }
  | { ok: false; reason: 'not-found' | 'not-read'; detail: string };

function readable(note: RawNote): boolean {
  return whyNotRead({ path: note.path, body: note.body ?? '' }) === null;
}

function toNote(note: RawNote): MayaNote {
  return { id: note.id, title: note.title?.trim() || 'Untitled', body: note.body ?? '' };
}

/**
 * Gather the material for one note. Errors from the ports are the caller's to
 * catch; `retrieveMaterial` below catches them.
 */
export async function gatherMaterial(ports: MayaRetrievePorts, noteId: string): Promise<RetrieveResult> {
  const subject = await ports.note(noteId);
  if (!subject) return { ok: false, reason: 'not-found', detail: 'The note was not found.' };
  const refusal = whyNotRead({ path: subject.path, body: subject.body ?? '' });
  if (refusal) return { ok: false, reason: 'not-read', detail: refusal.detail };

  const bodies = new Map<string, MayaNote>();
  bodies.set(subject.id, toNote(subject));

  // 1. Related notes. Asked for a few more than are kept, since some may be
  // refused once their bodies are read.
  const vector = await ports.vector(noteId);
  const nearest = vector ? await ports.nearest(vector, MAYA_RELATED_NOTES + 4, [noteId]) : [];
  const candidates = nearest.filter(
    (row) => row.note_id !== noteId && Number.isFinite(row.similarity) && row.similarity >= RELATED_NOTE_MIN_SIMILARITY,
  );
  const fetched = new Map((await ports.notes(candidates.map((row) => row.note_id))).map((n) => [n.id, n]));
  const related: MayaRelatedNote[] = [];
  for (const row of candidates) {
    const note = fetched.get(row.note_id);
    if (!note || !readable(note)) continue;
    const shaped = toNote(note);
    bodies.set(shaped.id, shaped);
    related.push({ ...shaped, similarity: row.similarity });
    if (related.length >= MAYA_RELATED_NOTES) break;
  }

  // 2 and 3. Positions from this note and the related ones, then those
  // sharing a theme.
  const links = await ports.positionsOfNotes([noteId, ...related.map((n) => n.id)]);
  const via = new Map<string, MayaPosition['via']>();
  for (const link of links) {
    const kind = link.note_id === noteId ? 'this-note' : 'related-note';
    if (via.get(link.position_id) !== 'this-note') via.set(link.position_id, kind);
  }
  const own = links.filter((l) => l.note_id === noteId).map((l) => l.position_id);
  for (const id of await ports.positionsSharingThemes(noteId, own)) {
    if (!via.has(id)) via.set(id, 'theme');
  }

  const raw = via.size > 0 ? await ports.positions([...via.keys()]) : [];

  // The notes behind every quote, read to apply whyNotRead and to check
  // quotes against the whole body later.
  const unseen = [...new Set(raw.flatMap((p) => p.sources.map((s) => s.note_id)))].filter((id) => !bodies.has(id));
  const refused = new Set<string>();
  for (const note of unseen.length > 0 ? await ports.notes(unseen) : []) {
    if (readable(note)) bodies.set(note.id, toNote(note));
    else refused.add(note.id);
  }
  // A quote's note that could not be read at all is treated as refused.
  for (const id of unseen) if (!bodies.has(id)) refused.add(id);

  const order: Record<MayaPosition['via'], number> = { 'this-note': 0, 'related-note': 1, theme: 2 };
  const positions = raw
    .map((p) => {
      const quotes = p.sources
        .filter((s) => !refused.has(s.note_id) && bodies.has(s.note_id) && s.quote.trim())
        .slice(0, MAYA_QUOTES_PER_POSITION)
        .map((s) => ({ noteId: s.note_id, noteTitle: bodies.get(s.note_id)!.title, quote: s.quote.trim() }));
      return { p, quotes };
    })
    // A position whose quotes all come from refused notes was written from them.
    .filter(({ p, quotes }) => quotes.length > 0 || p.sources.length === 0)
    .sort(
      (a, b) =>
        order[via.get(a.p.id)!] - order[via.get(b.p.id)!] || (b.p.centrality ?? 0) - (a.p.centrality ?? 0),
    )
    .slice(0, MAYA_POSITIONS)
    .map(({ p, quotes }) => ({
      id: p.id,
      name: p.name,
      statement: p.statement,
      stance: p.stance,
      via: via.get(p.id)!,
      quotes,
    }));

  // 4. Conflicts among the positions kept.
  const kept = new Set(positions.map((p) => p.id));
  const conflicts =
    positions.length >= 2
      ? (await ports.conflicts([...kept])).filter((c) => kept.has(c.leftId) && kept.has(c.rightId) && c.leftId !== c.rightId)
      : [];

  return {
    ok: true,
    material: {
      note: { ...toNote(subject), blobSha: subject.blob_sha ?? null },
      related,
      positions,
      conflicts: dedupeConflicts(conflicts),
      bodies,
    },
  };
}

/** One conflict per pair, a tension preferred over an edge since it may name the crux. */
function dedupeConflicts(conflicts: MayaConflict[]): MayaConflict[] {
  const byPair = new Map<string, MayaConflict>();
  for (const c of conflicts) {
    const key = [c.leftId, c.rightId].sort().join('|');
    const had = byPair.get(key);
    if (!had || (had.origin === 'contradicts' && c.origin === 'tension')) byPair.set(key, c);
  }
  return [...byPair.values()];
}

// ---------------------------------------------------------------------------
// The ports over the vault client
// ---------------------------------------------------------------------------

/** Reads through the vault client for one person. Every query names the account. */
export function mayaRetrieveStore(vault: VaultSupabaseClient, userId: string): MayaRetrievePorts {
  const fail = (what: string, message: string) => new Error(`maya: reading ${what} failed (${message})`);

  return {
    async note(noteId) {
      const { data, error } = await vault
        .from('notes')
        .select('id, path, title, body, blob_sha')
        .eq('user_id', userId)
        .eq('id', noteId)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) throw fail('the note', error.message);
      return (data as RawNote | null) ?? null;
    },

    async vector(noteId) {
      const { data, error } = await vault
        .from('note_embeddings')
        .select('embedding, embedding_model')
        .eq('user_id', userId)
        .eq('note_id', noteId)
        .maybeSingle();
      if (error) throw fail("the note's vector", error.message);
      if (!data) return null;
      const vector = readVector(data.embedding);
      return vector ? { vector, model: String(data.embedding_model) } : null;
    },

    async nearest({ vector, model }, limit, exclude) {
      const { data, error } = await vault.rpc('nearest_notes', {
        query_embedding: vectorLiteral(vector),
        p_user_id: userId,
        match_limit: limit,
        min_similarity: RELATED_NOTE_MIN_SIMILARITY,
        embedding_model_filter: model,
        p_exclude: exclude.length > 0 ? exclude : null,
      });
      if (error) throw fail('the nearest notes', error.message);
      return (data ?? []) as NearestRow[];
    },

    async notes(ids) {
      if (ids.length === 0) return [];
      const { data, error } = await vault
        .from('notes')
        .select('id, path, title, body')
        .eq('user_id', userId)
        .in('id', ids)
        .is('deleted_at', null);
      if (error) throw fail('notes', error.message);
      return (data ?? []) as RawNote[];
    },

    async positionsOfNotes(noteIds) {
      if (noteIds.length === 0) return [];
      const { data, error } = await vault
        .from('position_sources')
        .select('position_id, note_id')
        .eq('user_id', userId)
        .in('note_id', noteIds);
      if (error) throw fail("the notes' positions", error.message);
      return (data ?? []) as { position_id: string; note_id: string }[];
    },

    async positionsSharingThemes(noteId, positionIds) {
      const themeIds = new Set<string>();
      const { data: byNote, error: noteError } = await vault
        .from('theme_notes')
        .select('theme_id')
        .eq('user_id', userId)
        .eq('note_id', noteId);
      if (noteError) throw fail("the note's themes", noteError.message);
      for (const row of byNote ?? []) themeIds.add(String(row.theme_id));
      if (positionIds.length > 0) {
        const { data: byPosition, error } = await vault
          .from('theme_positions')
          .select('theme_id')
          .eq('user_id', userId)
          .in('position_id', positionIds);
        if (error) throw fail("the positions' themes", error.message);
        for (const row of byPosition ?? []) themeIds.add(String(row.theme_id));
      }
      if (themeIds.size === 0) return [];
      const { data, error } = await vault
        .from('theme_positions')
        .select('position_id')
        .eq('user_id', userId)
        .in('theme_id', [...themeIds]);
      if (error) throw fail('positions sharing a theme', error.message);
      return [...new Set((data ?? []).map((row) => String(row.position_id)))];
    },

    async positions(ids) {
      if (ids.length === 0) return [];
      const { data, error } = await vault
        .from('positions')
        .select('id, name, statement, stance, centrality, position_sources(note_id, quote)')
        .eq('user_id', userId)
        .in('id', ids)
        .is('ungrounded_at', null);
      if (error) throw fail('positions', error.message);
      return (data ?? []).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        statement: String(row.statement),
        stance: String(row.stance),
        centrality: row.centrality === null ? null : Number(row.centrality),
        sources: ((row.position_sources ?? []) as { note_id: string; quote: string | null }[]).map((s) => ({
          note_id: s.note_id,
          quote: s.quote ?? '',
        })),
      }));
    },

    async conflicts(ids) {
      if (ids.length < 2) return [];
      const [tensions, edges] = await Promise.all([
        vault
          .from('tensions')
          .select('left_id, right_id, crux')
          .eq('user_id', userId)
          .in('status', ['open', 'live_dispute'])
          .in('left_id', ids)
          .in('right_id', ids),
        vault
          .from('position_edges')
          .select('from_id, to_id, description')
          .eq('user_id', userId)
          .eq('type', 'contradicts')
          .in('from_id', ids)
          .in('to_id', ids),
      ]);
      if (tensions.error) throw fail('tensions', tensions.error.message);
      if (edges.error) throw fail('contradictions', edges.error.message);
      return [
        ...(tensions.data ?? []).map((t) => ({
          leftId: String(t.left_id),
          rightId: String(t.right_id),
          crux: (t.crux as string | null) ?? null,
          origin: 'tension' as const,
        })),
        ...(edges.data ?? []).map((e) => ({
          leftId: String(e.from_id),
          rightId: String(e.to_id),
          crux: (e.description as string | null) ?? null,
          origin: 'contradicts' as const,
        })),
      ];
    },
  };
}

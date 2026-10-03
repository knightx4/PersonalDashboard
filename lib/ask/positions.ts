import { AskInputError, type AskContext, type AskRow, type AskToolResult } from './db';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { gatherMaterial, mayaRetrieveStore, type MayaRetrievePorts } from '@/lib/vault/maya/retrieve';
import { noteHref } from '@/lib/vault/paths';

/**
 * note_positions: Maya's retrieval over the vault as one of Dash's lookups
 * (plan #1479; docs/CORE-AND-DASH-SPEC.md, decision 2). For one note it reads
 * what Maya reads before writing a thought (lib/vault/maya/retrieve.ts): the
 * person's other notes nearest it by meaning, the positions their notes have
 * been read as holding that bear on it, with the passages they were read
 * from, and which of those positions conflict.
 *
 * The note is named by the ref vault_notes, search or recall returned for it,
 * which is its path, or by its id. A note the vault does not read (a journal,
 * an excluded folder, one holding a key) is refused, as Maya refuses it.
 */

/** Characters of each related note's text given as its excerpt. */
const EXCERPT_CHARS = 400;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clip(text: string, chars: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > chars ? `${flat.slice(0, chars - 1).trimEnd()}…` : flat;
}

/** The reads the lookup makes beyond retrieval, so it can be tested without a database. */
export type NotePositionsPorts = MayaRetrievePorts & {
  /** The note's id and path, by path or id. */
  find(ref: string): Promise<{ id: string; path: string } | null>;
  /** Paths by note id, for linking to each related note. */
  paths(ids: string[]): Promise<Map<string, string>>;
};

function portsFor(vault: VaultSupabaseClient, userId: string): NotePositionsPorts {
  return {
    ...mayaRetrieveStore(vault, userId),
    async find(ref) {
      const { data, error } = await vault
        .from('notes')
        .select('id, path')
        .eq('user_id', userId)
        .eq(UUID.test(ref) ? 'id' : 'path', ref)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) throw new Error(`notes: ${error.message}`);
      return (data as { id: string; path: string } | null) ?? null;
    },
    async paths(ids) {
      if (ids.length === 0) return new Map();
      const { data, error } = await vault.from('notes').select('id, path').eq('user_id', userId).in('id', ids);
      if (error) throw new Error(`notes: ${error.message}`);
      return new Map(((data ?? []) as { id: string; path: string }[]).map((row) => [row.id, row.path]));
    },
  };
}

export async function notePositionsLookup(
  ctx: AskContext,
  input: Record<string, unknown>,
  ports?: NotePositionsPorts,
): Promise<AskToolResult> {
  const ref = typeof input.ref === 'string' ? input.ref.trim() : '';
  if (!ref) throw new AskInputError('Give the note by the ref vault_notes, search or recall returned for it.');

  const reads = ports ?? portsFor((await ctx.db('obsidian')) as unknown as VaultSupabaseClient, ctx.userId);
  const note = await reads.find(ref);
  if (!note) return { ok: false, error: 'No note in the vault has that ref.' };

  const found = await gatherMaterial(reads, note.id);
  if (!found.ok) return { ok: false, error: found.detail };
  const { material } = found;

  const quoted = material.positions.flatMap((p) => p.quotes.map((q) => q.noteId));
  const paths = await reads.paths([...new Set([...material.related.map((n) => n.id), ...quoted])]);

  const rows: AskRow[] = [];
  for (const related of material.related) {
    const path = paths.get(related.id);
    if (!path) continue;
    rows.push({
      table: 'obsidian.notes',
      ref: path,
      title: related.title,
      href: noteHref(path),
      detail: { kind: 'related note', closeness: Math.round(related.similarity * 100) / 100, excerpt: clip(related.body, EXCERPT_CHARS) },
    });
  }

  const label = new Map(material.positions.map((p, i) => [p.id, `P${i + 1}`]));
  for (const position of material.positions) {
    rows.push({
      table: 'obsidian.positions',
      ref: position.id,
      title: position.name,
      href: '/vault/map',
      detail: {
        kind: 'position',
        label: label.get(position.id) ?? null,
        stance: position.stance,
        statement: position.statement,
        reached:
          position.via === 'this-note' ? 'from this note' : position.via === 'related-note' ? 'from a related note' : 'through a shared theme',
        passages: position.quotes.map((q) => `${q.noteTitle}: "${q.quote}"`).join(' | ') || null,
      },
    });
  }

  const conflicts = material.conflicts
    .map((c) => {
      const left = label.get(c.leftId);
      const right = label.get(c.rightId);
      return left && right ? `${left} and ${right}${c.crux ? `: ${c.crux}` : ''}` : null;
    })
    .filter((line): line is string => line !== null);

  return {
    ok: true,
    rows,
    totals: { related_notes: material.related.length, positions: material.positions.length, conflicts },
    note:
      `About "${material.note.title}". Positions are labelled P1, P2 and so on; conflicts name the two that disagree.` +
      (rows.length === 0 ? ' No other note is close to it and no position bears on it yet.' : ''),
  };
}

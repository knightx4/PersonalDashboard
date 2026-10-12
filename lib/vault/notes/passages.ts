import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { vectorLiteral } from '@/lib/learn/catalogue/embed-sweep';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { noteHref } from '@/lib/vault/paths';
import {
  relatedNotesStore,
  vectorForText,
  type RelatedNotesPorts,
  type Vectorised,
} from '@/lib/vault/notes/related';

/**
 * The passages of the person's notes nearest a piece of text (plan #1863.7),
 * for the essay page's study panel, which searches with the paragraph being
 * written.
 *
 * The blocks are kept by lib/vault/notes/block-index.ts and searched by
 * obsidian.nearest_note_blocks (supabase/migrations-vault/0035). The text is
 * embedded the way relatedNotes embeds it, through the same cache in
 * obsidian.text_embeddings and under the same `embed-note-match` spend, so a
 * paragraph already checked by Already Said costs nothing more to search.
 *
 * Never throws: no key, a failed call or a failed read returns no passages.
 */

/**
 * The similarity a passage must reach by default. Set at the note floor
 * (RELATED_NOTE_MIN_SIMILARITY) until passages have been read against the
 * live vault; a passage is narrower than a note, so the right floor may be
 * higher.
 */
export const PASSAGE_MIN_SIMILARITY = 0.55;

/** How many passages by default. */
export const PASSAGES_SHOWN = 3;

export type NotePassage = {
  blockId: string;
  noteId: string;
  /** The note's path in the vault, e.g. `Ideas/On pricing.md`. */
  path: string;
  title: string;
  /** The headings above the passage, outermost first; empty before the first. */
  headingPath: string[];
  /** The passage as it stands in the note, its heading line included. */
  text: string;
  similarity: number;
  /** The note's page in the app. */
  href: string;
};

export type PassageOptions = {
  limit?: number;
  minSimilarity?: number;
  /** Notes to leave out, such as the essay's own note. */
  exclude?: string[];
};

type NearestBlockRow = {
  block_id: string;
  note_id: string;
  path: string;
  title: string | null;
  heading_path: string[] | null;
  passage: string | null;
  similarity: number;
};

export type PassagePorts = Pick<RelatedNotesPorts, 'cached' | 'keep' | 'embed' | 'ledger'> & {
  nearestBlocks(vector: Vectorised, options: Required<PassageOptions>): Promise<NearestBlockRow[]>;
};

function settle(options: PassageOptions): Required<PassageOptions> {
  return {
    limit: options.limit ?? PASSAGES_SHOWN,
    minSimilarity: options.minSimilarity ?? PASSAGE_MIN_SIMILARITY,
    exclude: options.exclude ?? [],
  };
}

export function toPassages(rows: NearestBlockRow[], floor: number): NotePassage[] {
  return rows
    .filter((row) => Number.isFinite(row.similarity) && row.similarity >= floor && row.passage)
    .map((row) => ({
      blockId: row.block_id,
      noteId: row.note_id,
      path: row.path,
      title: row.title?.trim() || row.path,
      headingPath: row.heading_path ?? [],
      text: row.passage ?? '',
      similarity: row.similarity,
      href: noteHref(row.path),
    }));
}

/** The loop over the ports, for the tests. Errors are the caller's to catch. */
export async function findPassages(
  ports: PassagePorts,
  text: string,
  options: PassageOptions = {},
): Promise<NotePassage[]> {
  const settled = settle(options);
  const vector = await vectorForText(ports, text);
  if (!vector) return [];
  return toPassages(await ports.nearestBlocks(vector, settled), settled.minSimilarity);
}

export function passageStore(
  vault: VaultSupabaseClient,
  userId: string,
  options: { core?: Pick<CoreSupabaseClient, 'from'> | null; apiKey?: string | null } = {},
): PassagePorts {
  const notes = relatedNotesStore(vault, userId, options);
  return {
    cached: notes.cached,
    keep: notes.keep,
    embed: notes.embed,
    ledger: notes.ledger,
    async nearestBlocks({ vector, model }, settled) {
      const { data, error } = await vault.rpc('nearest_note_blocks', {
        query_embedding: vectorLiteral(vector),
        p_user_id: userId,
        match_limit: settled.limit,
        min_similarity: settled.minSimilarity,
        embedding_model_filter: model,
        p_exclude: settled.exclude.length > 0 ? settled.exclude : null,
      });
      if (error) throw new Error(`Finding passages failed: ${error.message}`);
      return (data ?? []) as NearestBlockRow[];
    },
  };
}

/**
 * The passages of the person's notes nearest `text`, closest first, at most
 * `limit` (PASSAGES_SHOWN) and each at or above `minSimilarity`
 * (PASSAGE_MIN_SIMILARITY). Pass `core` to record what an embedding call cost;
 * a text already asked about costs nothing.
 */
export async function relatedPassages(
  vault: VaultSupabaseClient,
  userId: string,
  text: string,
  options: PassageOptions & {
    core?: Pick<CoreSupabaseClient, 'from'> | null;
    apiKey?: string | null;
  } = {},
): Promise<NotePassage[]> {
  try {
    return await findPassages(passageStore(vault, userId, options), text, options);
  } catch (error) {
    console.error('[vault passages]', error instanceof Error ? error.message : error);
    return [];
  }
}

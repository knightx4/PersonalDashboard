import 'server-only';

import { createHash } from 'node:crypto';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import { vectorLiteral } from '@/lib/learn/catalogue/embed-sweep';
import { embedOne } from '@/lib/learn/embed/embed';
import { DEFAULT_EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from '@/lib/learn/embed/voyage';
import type { LearnOperation } from '@/lib/learn/spend';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { noteHref } from '@/lib/vault/paths';

/**
 * The person's own notes nearest a piece of text (plan #1112, under #1110).
 *
 * A news story, a Learn card, a job or a goal passes the text it shows, and
 * gets back at most two vault notes that clear RELATED_NOTE_MIN_SIMILARITY,
 * closest first, or none. Nothing is shown for a weak match: a panel that
 * always has something in it teaches you to stop reading it.
 *
 * The text is embedded as a document, the way the notes are
 * (lib/vault/notes/embed.ts), because what is being asked is whether two
 * pieces of writing are about the same thing. It is also how news stories
 * (news.story_groups) and Learn concepts are already embedded, so a caller
 * holding one of those vectors can pass it to relatedNotesForVector and skip
 * the embedding call.
 *
 * The vector for a text is kept in obsidian.text_embeddings by the sha256 of
 * the text and the model, so the same story or card seen twice is embedded
 * once. The lookup is obsidian.nearest_notes (supabase/migrations-vault/0022),
 * which leaves out soft-deleted notes, notes with under 20 characters written
 * in them (0023), and templates and CLAUDE.md or AGENTS.md files (0024).
 *
 * Never throws. No key, a failed call or a failed read returns no notes, and
 * the page shows none.
 */

/**
 * The cosine similarity a note must reach to be shown beside something.
 *
 * Read off the live vault once all 1,288 notes had vectors (plan #1112). For
 * each of the 279 stored news stories and 132 Learn concepts the nearest notes
 * were listed and read. From 0.60 up the match was right nearly every time:
 * a grid-funding story found the note on energy, a housing-reform story the
 * two notes on affordable housing. Between 0.55 and 0.60 most were still
 * right, such as a Tencent story finding the note on China's economy. Below
 * 0.55 it turned into a coin toss, with broad notes like a list of video ideas
 * or a note on social movements turning up for stories they have nothing to do
 * with. At 0.55 a quarter of stories (69 of 279) and of concepts (35 of 132)
 * show a note; the rest show none.
 */
export const RELATED_NOTE_MIN_SIMILARITY = 0.55;

/** At most this many related notes on a page (settled in #1110). */
export const RELATED_NOTES_SHOWN = 2;

/**
 * Characters of a page's text that are embedded. A story's headline and
 * summary or a card's text is well under this; the cap keeps a long job
 * description from costing a long call.
 */
export const MATCH_TEXT_MAX_CHARS = 8_000;

const OPERATION: LearnOperation = 'embed-note-match';

export type RelatedNote = {
  noteId: string;
  /** The note's path in the vault, e.g. `Ideas/On pricing.md`. */
  path: string;
  title: string;
  similarity: number;
  /** The note's page in the app. */
  href: string;
};

export type RelatedNotesOptions = {
  /** How many to return. Defaults to RELATED_NOTES_SHOWN. */
  limit?: number;
  /** Defaults to RELATED_NOTE_MIN_SIMILARITY. */
  minSimilarity?: number;
  /** Notes to leave out, such as the note a connection starts from. */
  exclude?: string[];
};

/** The text as it is embedded: trimmed, runs of whitespace closed up, cut. */
export function matchText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MATCH_TEXT_MAX_CHARS);
}

/** The cache key for a text, taken after matchText. */
export function matchTextHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export type Vectorised = { vector: number[]; model: string };

type NearestRow = { note_id: string; path: string; title: string | null; similarity: number };

export type RelatedNotesPorts = {
  /** The kept vector for this hash and model, or null. */
  cached(hash: string, model: string): Promise<number[] | null>;
  /** Keep a vector for next time. */
  keep(hash: string, vector: Vectorised): Promise<void>;
  /** Embed one text as a document. */
  embed(text: string, onSpend: (report: SpendReport) => void): Promise<Vectorised | null>;
  nearest(vector: Vectorised, options: Required<RelatedNotesOptions>): Promise<NearestRow[]>;
  /** Told what an embedding call cost. */
  ledger?(report: SpendReport): Promise<void>;
};

function withDefaults(options: RelatedNotesOptions): Required<RelatedNotesOptions> {
  return {
    limit: options.limit ?? RELATED_NOTES_SHOWN,
    minSimilarity: options.minSimilarity ?? RELATED_NOTE_MIN_SIMILARITY,
    exclude: options.exclude ?? [],
  };
}

function toRelated(rows: NearestRow[], floor: number): RelatedNote[] {
  return rows
    .filter((row) => Number.isFinite(row.similarity) && row.similarity >= floor)
    .map((row) => ({
      noteId: row.note_id,
      path: row.path,
      title: row.title?.trim() || row.path,
      similarity: row.similarity,
      href: noteHref(row.path),
    }));
}

/** The vector for a text: the kept one, or a new one that is then kept. */
export async function vectorForText(
  ports: Pick<RelatedNotesPorts, 'cached' | 'keep' | 'embed' | 'ledger'>,
  text: string,
): Promise<Vectorised | null> {
  const cut = matchText(text);
  if (cut === '') return null;
  const hash = matchTextHash(cut);

  const kept = await ports.cached(hash, DEFAULT_EMBEDDING_MODEL);
  if (kept) return { vector: kept, model: DEFAULT_EMBEDDING_MODEL };

  const reports: SpendReport[] = [];
  const made = await ports.embed(cut, (report) => reports.push(report));
  for (const report of reports) await ports.ledger?.(report);
  if (!made) return null;

  await ports.keep(hash, made);
  return made;
}

/** The loop over the ports, for the tests. Errors are the caller's to catch. */
export async function findRelatedNotes(
  ports: RelatedNotesPorts,
  text: string,
  options: RelatedNotesOptions = {},
): Promise<RelatedNote[]> {
  const settled = withDefaults(options);
  const vector = await vectorForText(ports, text);
  if (!vector) return [];
  return toRelated(await ports.nearest(vector, settled), settled.minSimilarity);
}

/**
 * A vector as PostgREST returns a pgvector column: the text `[0.1,…]`, or an
 * array already parsed. Null for anything that is not a full-length vector.
 */
export function readVector(value: unknown): number[] | null {
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  return Array.isArray(parsed) &&
    parsed.length === EMBEDDING_DIMENSIONS &&
    parsed.every((n) => typeof n === 'number')
    ? parsed
    : null;
}

/**
 * The ports over the vault client, for one person. `userId` is always named:
 * the cache row needs an owner, and a service-role caller must not search
 * everybody's notes.
 */
export function relatedNotesStore(
  vault: VaultSupabaseClient,
  userId: string,
  options: { core?: Pick<CoreSupabaseClient, 'from'> | null; apiKey?: string | null } = {},
): RelatedNotesPorts {
  return {
    async cached(hash, model) {
      const { data, error } = await vault
        .from('text_embeddings')
        .select('embedding, used_at')
        .eq('user_id', userId)
        .eq('text_hash', hash)
        .eq('embedding_model', model)
        .maybeSingle();
      if (error) throw new Error(`Reading a kept text vector failed: ${error.message}`);
      if (!data) return null;
      // Touched at most once a day, so a row still in use is not cleared.
      const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
      if (typeof data.used_at === 'string' && data.used_at < dayAgo) {
        await vault
          .from('text_embeddings')
          .update({ used_at: new Date().toISOString() })
          .eq('user_id', userId)
          .eq('text_hash', hash)
          .eq('embedding_model', model);
      }
      return readVector(data.embedding);
    },

    async keep(hash, { vector, model }) {
      const { error } = await vault.from('text_embeddings').upsert(
        {
          user_id: userId,
          text_hash: hash,
          embedding_model: model,
          embedding: vectorLiteral(vector),
          used_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,text_hash,embedding_model' },
      );
      // Not keeping it only costs another call next time.
      if (error) console.error('[vault related notes] keeping a text vector failed', error.message);
    },

    async embed(text, onSpend) {
      const outcome = await embedOne(text, { inputType: 'document', apiKey: options.apiKey, onSpend });
      if (!outcome.ok) {
        if (outcome.reason !== 'no-key') {
          console.error('[vault related notes]', outcome.reason, outcome.detail);
        }
        return null;
      }
      return { vector: outcome.vector, model: outcome.model };
    },

    async nearest({ vector, model }, settled) {
      const { data, error } = await vault.rpc('nearest_notes', {
        query_embedding: vectorLiteral(vector),
        p_user_id: userId,
        match_limit: settled.limit,
        min_similarity: settled.minSimilarity,
        embedding_model_filter: model,
        p_exclude: settled.exclude.length > 0 ? settled.exclude : null,
      });
      if (error) throw new Error(`Finding related notes failed: ${error.message}`);
      return (data ?? []) as NearestRow[];
    },

    ledger: options.core
      ? async (report) => {
          await recordSpend(options.core!, userId, {
            module: 'learn',
            operation: OPERATION,
            model: report.model,
            usage: report.usage,
          });
        }
      : undefined,
  };
}

/**
 * The person's notes nearest a text, at most RELATED_NOTES_SHOWN and each
 * above RELATED_NOTE_MIN_SIMILARITY. Pass `core` to record what an embedding
 * call cost; a text already asked about costs nothing.
 */
export async function relatedNotes(
  vault: VaultSupabaseClient,
  userId: string,
  text: string,
  options: RelatedNotesOptions & {
    core?: Pick<CoreSupabaseClient, 'from'> | null;
    apiKey?: string | null;
  } = {},
): Promise<RelatedNote[]> {
  try {
    return await findRelatedNotes(relatedNotesStore(vault, userId, options), text, options);
  } catch (error) {
    console.error('[vault related notes]', error instanceof Error ? error.message : error);
    return [];
  }
}

/**
 * The same, from a vector the caller already holds: a news story's row in
 * news.story_groups or a Learn concept's. It must be a document vector from a
 * model the notes were embedded with; the lookup only compares like with like.
 */
export async function relatedNotesForVector(
  vault: VaultSupabaseClient,
  userId: string,
  vector: Vectorised,
  options: RelatedNotesOptions = {},
): Promise<RelatedNote[]> {
  const settled = withDefaults(options);
  try {
    const rows = await relatedNotesStore(vault, userId).nearest(vector, settled);
    return toRelated(rows, settled.minSimilarity);
  } catch (error) {
    console.error('[vault related notes]', error instanceof Error ? error.message : error);
    return [];
  }
}

/** What a page needs to draw a related note: its title and where it opens. */
export type RelatedNoteLink = Pick<RelatedNote, 'noteId' | 'title' | 'href'>;

/** A stored document vector a page already holds, under the key it looks it up by. */
export type StoredVector = { key: string; embedding: unknown; model: string | null };

/**
 * The related notes for several stored vectors at once, such as every story
 * on a Quick read page, keyed as they were passed. A vector that does not
 * parse, or has no model, gets none. The lookups run side by side; each is one
 * call to obsidian.nearest_notes. Never throws.
 */
export async function relatedNotesForStored(
  vault: VaultSupabaseClient,
  userId: string,
  stored: readonly StoredVector[],
  options: RelatedNotesOptions = {},
): Promise<Map<string, RelatedNoteLink[]>> {
  const found = await Promise.all(
    stored.map(async ({ key, embedding, model }): Promise<[string, RelatedNoteLink[]]> => {
      let vector: number[] | null = null;
      try {
        vector = readVector(embedding);
      } catch {
        vector = null;
      }
      if (!vector || !model) return [key, []];
      const notes = await relatedNotesForVector(vault, userId, { vector, model }, options);
      return [key, notes.map(toLink)];
    }),
  );
  return new Map(found);
}

/** The fields a page draws, without the score: the score is not shown (law 3). */
export function toLink({ noteId, title, href }: RelatedNote): RelatedNoteLink {
  return { noteId, title, href };
}

import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import { vectorLiteral } from '@/lib/learn/catalogue/embed-sweep';
import { embedTexts, type EmbedOutcome } from '@/lib/learn/embed/embed';
import { DEFAULT_EMBEDDING_MODEL, type EmbeddingModel } from '@/lib/learn/embed/voyage';
import type { LearnOperation } from '@/lib/learn/spend';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { splitNoteBlocks, type NoteBlock } from '@/lib/vault/notes/blocks';

/**
 * Keeping obsidian.note_blocks up to date (plan #1863.7): every live note
 * split at its headings, each passage with a vector, for passage search
 * (lib/vault/notes/passages.ts).
 *
 * Built like lib/vault/notes/embed.ts. obsidian.stale_note_blocks lists the
 * notes whose blocks are missing or were split from another version of the
 * note (supabase/migrations-vault/0035). Each is split here
 * (lib/vault/notes/blocks.ts), and only the blocks whose text hash the note
 * does not already hold a vector for are embedded; the rest keep theirs
 * inside obsidian.store_note_blocks. So editing one paragraph re-embeds one
 * block, and renaming a note re-embeds all of it, since the path is in what
 * each block embeds.
 *
 * Two callers, the same as the note vectors: the vault sync after a sync that
 * wrote notes (inngest/vault/sync.ts) and the map sweep's tick for every
 * account (inngest/vault/map-sweep.ts), which is also the backfill.
 *
 * Spend is recorded per account as `embed-note-blocks`.
 */

const OPERATION: LearnOperation = 'embed-note-blocks';

/** Notes per read. A long note is a hundred blocks, so this is kept small. */
const DEFAULT_CHUNK = 12;

export type StaleBlockNote = {
  noteId: string;
  userId: string;
  path: string;
  title: string | null;
  body: string;
  sourceHash: string;
};

/** One block as obsidian.store_note_blocks takes it. Null embedding keeps the old one. */
export type StoredBlock = {
  position: number;
  heading_path: string[];
  start_offset: number;
  end_offset: number;
  text_hash: string;
  embedding: string | null;
  model: string;
};

export type BlockIndexPorts = {
  /** At most `limit` notes whose blocks are missing or stale, grouped by owner. */
  stale(limit: number): Promise<StaleBlockNote[]>;
  /** The text hashes these notes already hold a vector for, as `noteId:hash`. */
  embedded(noteIds: string[], model: string): Promise<Set<string>>;
  /** Replace one note's blocks, if it still hashes to `sourceHash`. */
  store(noteId: string, sourceHash: string, rows: StoredBlock[]): Promise<number>;
  embed(input: {
    texts: string[];
    model: EmbeddingModel;
    onSpend: (report: SpendReport) => void;
  }): Promise<EmbedOutcome>;
  ledger?(userId: string, report: SpendReport): Promise<void>;
};

export type BlockIndexOptions = {
  model?: EmbeddingModel;
  chunk?: number;
  /** A time, in epoch milliseconds, after which no further chunk is started. */
  deadline?: number;
  now?: () => number;
};

export type BlockIndexResult = {
  /** Notes whose blocks were written. */
  notes: number;
  /** Notes not written because they changed while they were split. */
  skipped: number;
  blocks: number;
  /** Blocks sent to be embedded; the rest kept the vector they had. */
  embedded: number;
  tokens: number;
  stopped: { reason: string; detail: string } | null;
};

const key = (noteId: string, hash: string): string => `${noteId}:${hash}`;

export function storedRows(
  blocks: NoteBlock[],
  vectors: Map<string, number[]>,
  model: string,
): StoredBlock[] {
  return blocks.map((block) => {
    const vector = block.searchable ? vectors.get(block.textHash) : undefined;
    return {
      position: block.position,
      heading_path: block.headingPath,
      start_offset: block.start,
      end_offset: block.end,
      text_hash: block.textHash,
      embedding: vector ? vectorLiteral(vector) : null,
      model,
    };
  });
}

/** The loop, over the ports. Stops like runNoteEmbed. */
export async function runBlockIndex(
  ports: BlockIndexPorts,
  options: BlockIndexOptions = {},
): Promise<BlockIndexResult> {
  const model = options.model ?? DEFAULT_EMBEDDING_MODEL;
  const chunk = Math.max(1, options.chunk ?? DEFAULT_CHUNK);
  const now = options.now ?? Date.now;
  const result: BlockIndexResult = { notes: 0, skipped: 0, blocks: 0, embedded: 0, tokens: 0, stopped: null };

  for (;;) {
    if (options.deadline !== undefined && now() >= options.deadline) {
      const left = await ports.stale(1);
      if (left.length > 0) {
        result.stopped = { reason: 'time', detail: 'ran out of time with notes still to split' };
      }
      return result;
    }

    const read = await ports.stale(chunk);
    if (read.length === 0) return result;
    const owner = read[0].userId;
    const notes = read.filter((note) => note.userId === owner);

    const split = notes.map((note) => ({ note, blocks: splitNoteBlocks(note) }));
    const have = await ports.embedded(
      notes.map((note) => note.noteId),
      model,
    );

    // One text per new hash, however many notes or blocks share it.
    const wanted = new Map<string, string>();
    for (const { note, blocks } of split) {
      for (const block of blocks) {
        if (block.searchable && !have.has(key(note.noteId, block.textHash))) {
          wanted.set(block.textHash, block.embedText);
        }
      }
    }

    const vectors = new Map<string, number[]>();
    if (wanted.size > 0) {
      const hashes = [...wanted.keys()];
      const reports: SpendReport[] = [];
      const outcome = await ports.embed({
        texts: hashes.map((hash) => wanted.get(hash)!),
        model,
        onSpend: (report) => reports.push(report),
      });
      result.tokens += outcome.tokens;
      for (const report of reports) await ports.ledger?.(owner, report);
      if (!outcome.ok) {
        result.stopped = { reason: outcome.reason, detail: outcome.detail };
        return result;
      }
      if (outcome.vectors.length !== hashes.length) {
        result.stopped = {
          reason: 'malformed',
          detail: `${outcome.vectors.length} vectors for ${hashes.length} blocks`,
        };
        return result;
      }
      hashes.forEach((hash, index) => vectors.set(hash, outcome.vectors[index]));
      result.embedded += hashes.length;
    }

    let written = 0;
    for (const { note, blocks } of split) {
      const count = await ports.store(note.noteId, note.sourceHash, storedRows(blocks, vectors, model));
      if (count > 0) {
        written += 1;
        result.blocks += count;
      } else {
        result.skipped += 1;
      }
    }
    result.notes += written;

    if (written === 0) {
      result.stopped = {
        reason: 'unchanged',
        detail: `${notes.length} notes were rewritten while they were being split`,
      };
      return result;
    }
  }
}

type StaleRpcRow = {
  note_id: string;
  user_id: string;
  path: string;
  title: string | null;
  body: string | null;
  source_hash: string;
};

/** The ports over the vault client. RLS applies when it is a session client. */
export function blockIndexStore(
  supabase: VaultSupabaseClient,
  userId: string | null,
): Pick<BlockIndexPorts, 'stale' | 'embedded' | 'store'> {
  return {
    async stale(limit) {
      const { data, error } = await supabase.rpc('stale_note_blocks', {
        p_limit: limit,
        p_user_id: userId,
      });
      if (error) throw new Error(`Reading notes to split failed: ${error.message}`);
      return ((data ?? []) as StaleRpcRow[]).map((row) => ({
        noteId: row.note_id,
        userId: row.user_id,
        path: row.path,
        title: row.title,
        body: row.body ?? '',
        sourceHash: row.source_hash,
      }));
    },

    async embedded(noteIds, model) {
      if (noteIds.length === 0) return new Set();
      const { data, error } = await supabase
        .from('note_blocks')
        .select('note_id, text_hash')
        .in('note_id', noteIds)
        .eq('embedding_model', model)
        .not('embedding', 'is', null);
      if (error) throw new Error(`Reading note blocks failed: ${error.message}`);
      return new Set(
        ((data ?? []) as { note_id: string; text_hash: string }[]).map((row) =>
          key(row.note_id, row.text_hash),
        ),
      );
    },

    async store(noteId, sourceHash, rows) {
      const { data, error } = await supabase.rpc('store_note_blocks', {
        p_note_id: noteId,
        p_source_hash: sourceHash,
        p_rows: rows,
      });
      if (error) throw new Error(`Writing note blocks failed: ${error.message}`);
      return typeof data === 'number' ? data : 0;
    },
  };
}

/**
 * Split and embed every note whose blocks are missing or stale. `userId` null
 * means every account's notes, which only a service client can see. `core` is
 * where the spend rows go; null writes none.
 */
export async function indexNoteBlocks(
  supabase: VaultSupabaseClient,
  core: Pick<CoreSupabaseClient, 'from'> | null,
  options: BlockIndexOptions & { userId?: string | null; apiKey?: string | null } = {},
): Promise<BlockIndexResult> {
  return runBlockIndex(
    {
      ...blockIndexStore(supabase, options.userId ?? null),
      embed: ({ texts, model, onSpend }) =>
        embedTexts({ texts, model, inputType: 'document', apiKey: options.apiKey, onSpend }),
      ledger: core
        ? async (owner, report) => {
            await recordSpend(core, owner, {
              module: 'learn',
              operation: OPERATION,
              model: report.model,
              usage: report.usage,
            });
          }
        : undefined,
    },
    options,
  );
}

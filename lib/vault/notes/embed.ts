import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import { vectorLiteral } from '@/lib/learn/catalogue/embed-sweep';
import { embedTexts, type EmbedOutcome } from '@/lib/learn/embed/embed';
import { DEFAULT_EMBEDDING_MODEL, type EmbeddingModel } from '@/lib/learn/embed/voyage';
import type { LearnOperation } from '@/lib/learn/spend';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';

/**
 * Giving every vault note a vector (plan #1111), so feature #1110 can match a
 * note to a story, a card, a job or a goal by what it is about.
 *
 * Built like lib/vault/map/embed.ts. The work to do is read from the
 * database, through obsidian.stale_note_embeddings: every live note with no
 * row in obsidian.note_embeddings, or whose row was made from other text. A
 * note leaves that list when obsidian.store_note_embeddings writes its vector
 * (supabase/migrations-vault/0021). The text is decided there too, by
 * obsidian.note_embedding_text (title, blank line, body, cut at 120,000
 * characters), and `body_hash` is its md5. This file never builds the text or
 * the hash itself, so the read, the write and the staleness check cannot
 * disagree about what a note says.
 *
 * An unchanged note is never embedded twice: its hash matches and it is not
 * in the list. A note edited between the read and the write is not written
 * and comes back on the next run.
 *
 * Two callers. The vault sync runs it for one account after a sync that wrote
 * notes, for a few seconds (inngest/vault/sync.ts). The map sweep's
 * five-minute tick runs it for every account (inngest/vault/map-sweep.ts),
 * which is both the backfill of the existing vault and the catch-up for
 * whatever a sync ran out of time for.
 *
 * Spend is recorded per account as `embed-notes`: one read is cut down to the
 * rows of its first owner, so a call never mixes two people's notes.
 */

const OPERATION: LearnOperation = 'embed-notes';

/**
 * Notes per read. A note can be 120,000 characters, and embedTexts splits a
 * list into requests by size as well as count, so this is about how much one
 * failure costs rather than about the provider's limits.
 */
const DEFAULT_CHUNK = 32;

export type StaleNote = { noteId: string; userId: string; text: string; bodyHash: string };

export type EmbeddedNote = StaleNote & { vector: number[]; model: string };

export type NoteEmbedPorts = {
  /** At most `limit` notes whose vector is missing or stale, grouped by owner. */
  stale(limit: number): Promise<StaleNote[]>;
  /** Write the vectors whose note still has the text they were made from. */
  store(rows: EmbeddedNote[]): Promise<number>;
  embed(input: {
    texts: string[];
    model: EmbeddingModel;
    onSpend: (report: SpendReport) => void;
  }): Promise<EmbedOutcome>;
  /** Told what each call cost and whose notes it was for. */
  ledger?(userId: string, report: SpendReport): Promise<void>;
};

export type NoteEmbedOptions = {
  model?: EmbeddingModel;
  chunk?: number;
  /** A time, in epoch milliseconds, after which no further chunk is started. */
  deadline?: number;
  now?: () => number;
};

export type NoteEmbedResult = {
  embedded: number;
  /** Vectors not written because the note changed while it was embedded. */
  skipped: number;
  calls: number;
  tokens: number;
  model: string | null;
  /** Why it stopped before running out of notes, or null if it did not. */
  stopped: { reason: string; detail: string } | null;
};

/**
 * The loop, over the ports.
 *
 * It stops on: nothing left, the deadline, an embedding failure, and a chunk
 * that wrote nothing, which keeps a note being rewritten under it from being
 * read and embedded forever.
 */
export async function runNoteEmbed(
  ports: NoteEmbedPorts,
  options: NoteEmbedOptions = {},
): Promise<NoteEmbedResult> {
  const model = options.model ?? DEFAULT_EMBEDDING_MODEL;
  const chunk = Math.max(1, options.chunk ?? DEFAULT_CHUNK);
  const now = options.now ?? Date.now;

  const result: NoteEmbedResult = {
    embedded: 0,
    skipped: 0,
    calls: 0,
    tokens: 0,
    model: null,
    stopped: null,
  };

  for (;;) {
    if (options.deadline !== undefined && now() >= options.deadline) {
      const left = await ports.stale(1);
      if (left.length > 0) {
        result.stopped = { reason: 'time', detail: 'ran out of time with notes still to embed' };
      }
      return result;
    }

    const read = await ports.stale(chunk);
    if (read.length === 0) return result;

    const owner = read[0].userId;
    const rows = read.filter((row) => row.userId === owner);

    const reports: SpendReport[] = [];
    const outcome = await ports.embed({
      texts: rows.map((row) => row.text),
      model,
      onSpend: (report) => reports.push(report),
    });

    result.calls += reports.length;
    result.tokens += outcome.tokens;
    for (const report of reports) await ports.ledger?.(owner, report);

    if (!outcome.ok) {
      result.stopped = { reason: outcome.reason, detail: outcome.detail };
      return result;
    }
    if (outcome.vectors.length !== rows.length) {
      // embedTexts returns one vector per text or none. Checked anyway: a
      // short list would give notes each other's vectors, and nothing would
      // ever throw.
      result.stopped = {
        reason: 'malformed',
        detail: `${outcome.vectors.length} vectors for ${rows.length} notes`,
      };
      return result;
    }

    result.model = outcome.model;
    const written = await ports.store(
      rows.map((row, index) => ({ ...row, vector: outcome.vectors[index], model: outcome.model })),
    );

    result.embedded += written;
    result.skipped += rows.length - written;

    if (written === 0) {
      result.stopped = {
        reason: 'unchanged',
        detail: `${rows.length} notes were rewritten while they were being embedded`,
      };
      return result;
    }
  }
}

type StaleRpcRow = { note_id: string; user_id: string; text: string; body_hash: string };

/** The ports over the vault client. RLS applies when it is a session client. */
export function noteEmbedStore(
  supabase: VaultSupabaseClient,
  userId: string | null,
): Pick<NoteEmbedPorts, 'stale' | 'store'> {
  return {
    async stale(limit) {
      const { data, error } = await supabase.rpc('stale_note_embeddings', {
        p_limit: limit,
        p_user_id: userId,
      });
      if (error) throw new Error(`Reading notes to embed failed: ${error.message}`);
      return ((data ?? []) as StaleRpcRow[]).map((row) => ({
        noteId: row.note_id,
        userId: row.user_id,
        text: row.text,
        bodyHash: row.body_hash,
      }));
    },

    async store(rows) {
      if (rows.length === 0) return 0;
      const { data, error } = await supabase.rpc('store_note_embeddings', {
        p_rows: rows.map((row) => ({
          note_id: row.noteId,
          body_hash: row.bodyHash,
          embedding: vectorLiteral(row.vector),
          model: row.model,
        })),
      });
      if (error) throw new Error(`Writing note embeddings failed: ${error.message}`);
      return typeof data === 'number' ? data : 0;
    },
  };
}

/**
 * Embed every note whose vector is missing or stale.
 *
 * `userId` null means every account's notes, which only a service client can
 * see. `core` is where the spend rows go; null writes none, and the tokens are
 * still reported in the result.
 */
export async function embedVaultNotes(
  supabase: VaultSupabaseClient,
  core: Pick<CoreSupabaseClient, 'from'> | null,
  options: NoteEmbedOptions & { userId?: string | null; apiKey?: string | null } = {},
): Promise<NoteEmbedResult> {
  return runNoteEmbed(
    {
      ...noteEmbedStore(supabase, options.userId ?? null),
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

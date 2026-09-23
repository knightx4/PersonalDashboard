import 'server-only';

import { after } from 'next/server';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import { vectorLiteral } from '@/lib/learn/catalogue/embed-sweep';
import { embedTexts, type EmbedOutcome } from '@/lib/learn/embed/embed';
import { DEFAULT_EMBEDDING_MODEL, type EmbeddingModel } from '@/lib/learn/embed/voyage';
import type { LearnOperation } from '@/lib/learn/spend';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';

/**
 * Giving a vector to every theme and position that has none (plan #810).
 *
 * The merge passes need to find two differently worded names for the same
 * subject, which trigram cannot. The vectors are what they compare.
 *
 * Built like the catalogue sweep in lib/learn/catalogue/embed-sweep.ts: the
 * work to do is the rows with no vector, read through
 * obsidian.unembedded_map_rows, and a row leaves that list when
 * obsidian.store_map_embeddings writes its vector (supabase/migrations-vault/
 * 0006). What is embedded is decided in the database by
 * obsidian.map_embedding_text, so this file never builds the text itself:
 * a theme is its name and its about, a position its statement. The store only
 * writes a vector whose row still has the text it was read with, and a row
 * whose text changes later loses its vector to a trigger, so it comes back
 * round.
 *
 * Two callers. The map sweep's cron tick runs this for every account after it
 * has worked the sweeps, which is both the backfill and how rows the sweep
 * accepted get their vectors. Accepting one note's map on its page runs it
 * for that person once the response has gone.
 *
 * Spend goes to the account whose rows were embedded, per #741: one read is
 * cut down to the rows of its first owner, so a call never mixes two
 * accounts' texts and its cost has one owner.
 */

export const MAP_ROW_KINDS = ['theme', 'position'] as const;

export type MapRowKind = (typeof MAP_ROW_KINDS)[number];

const OPERATION: LearnOperation = 'embed-map';

/**
 * Rows per read. Themes and positions are a sentence or two, so a chunk of 64
 * is one request and a failure costs one request's tokens.
 */
const DEFAULT_CHUNK = 64;

export type UnembeddedMapRow = { id: string; userId: string; text: string };

export type EmbeddedMapRow = UnembeddedMapRow & { vector: number[]; model: string };

export type MapEmbedPorts = {
  /** At most `limit` rows of this kind with no vector, grouped by owner. */
  unembedded(kind: MapRowKind, limit: number): Promise<UnembeddedMapRow[]>;
  /** Write the vectors whose row still has the text it was read with. */
  store(kind: MapRowKind, rows: EmbeddedMapRow[]): Promise<number>;
  embed(input: {
    texts: string[];
    model: EmbeddingModel;
    onSpend: (report: SpendReport) => void;
  }): Promise<EmbedOutcome>;
  /** Told what each call cost and whose rows it was for. */
  ledger?(userId: string, report: SpendReport): Promise<void>;
};

export type MapEmbedOptions = {
  model?: EmbeddingModel;
  chunk?: number;
  /** A time, in epoch milliseconds, after which no further chunk is started. */
  deadline?: number;
  now?: () => number;
};

export type MapEmbedResult = {
  themes: number;
  positions: number;
  /** Vectors not written because the row's text changed while it was embedded. */
  skipped: number;
  calls: number;
  tokens: number;
  model: string | null;
  /** Why it stopped before running out of rows, or null if it did not. */
  stopped: { reason: string; detail: string } | null;
};

/**
 * The loop, over the ports. Themes first, then positions.
 *
 * It stops on: nothing left, the deadline, an embedding failure, and a chunk
 * that wrote nothing, which is what keeps a row being rewritten under it from
 * being read and embedded forever.
 */
export async function runMapEmbed(
  ports: MapEmbedPorts,
  options: MapEmbedOptions = {},
): Promise<MapEmbedResult> {
  const model = options.model ?? DEFAULT_EMBEDDING_MODEL;
  const chunk = Math.max(1, options.chunk ?? DEFAULT_CHUNK);
  const now = options.now ?? Date.now;

  const result: MapEmbedResult = {
    themes: 0,
    positions: 0,
    skipped: 0,
    calls: 0,
    tokens: 0,
    model: null,
    stopped: null,
  };

  for (const kind of MAP_ROW_KINDS) {
    for (;;) {
      const read = await ports.unembedded(kind, chunk);
      if (read.length === 0) break;

      if (options.deadline !== undefined && now() >= options.deadline) {
        result.stopped = { reason: 'time', detail: 'ran out of time with rows still to embed' };
        return result;
      }

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
        // short list would give rows each other's vectors, and nothing would
        // ever throw.
        result.stopped = {
          reason: 'malformed',
          detail: `${outcome.vectors.length} vectors for ${rows.length} rows`,
        };
        return result;
      }

      result.model = outcome.model;
      const written = await ports.store(
        kind,
        rows.map((row, index) => ({ ...row, vector: outcome.vectors[index], model: outcome.model })),
      );

      if (kind === 'theme') result.themes += written;
      else result.positions += written;
      result.skipped += rows.length - written;

      if (written === 0) {
        result.stopped = {
          reason: 'unchanged',
          detail: `${rows.length} ${kind}s were rewritten while they were being embedded`,
        };
        return result;
      }
    }
  }

  return result;
}

type UnembeddedRpcRow = { id: string; user_id: string; text: string };

/** The ports over the vault client. RLS applies when it is a session client. */
export function mapEmbedStore(
  supabase: VaultSupabaseClient,
  userId: string | null,
): Pick<MapEmbedPorts, 'unembedded' | 'store'> {
  return {
    async unembedded(kind, limit) {
      const { data, error } = await supabase.rpc('unembedded_map_rows', {
        p_kind: kind,
        p_limit: limit,
        p_user_id: userId,
      });
      if (error) throw new Error(`Reading ${kind}s to embed failed: ${error.message}`);
      return ((data ?? []) as UnembeddedRpcRow[]).map((row) => ({
        id: row.id,
        userId: row.user_id,
        text: row.text,
      }));
    },

    async store(kind, rows) {
      if (rows.length === 0) return 0;
      const { data, error } = await supabase.rpc('store_map_embeddings', {
        p_kind: kind,
        p_rows: rows.map((row) => ({
          id: row.id,
          text: row.text,
          embedding: vectorLiteral(row.vector),
          model: row.model,
        })),
      });
      if (error) throw new Error(`Writing ${kind} embeddings failed: ${error.message}`);
      return typeof data === 'number' ? data : 0;
    },
  };
}

/**
 * Embed every theme and position with no vector.
 *
 * `userId` null means every account's rows, which only a service client can
 * see. `core` is where the spend rows go; null writes none, and the tokens are
 * still reported in the result.
 */
export async function embedMapRows(
  supabase: VaultSupabaseClient,
  core: Pick<CoreSupabaseClient, 'from'> | null,
  options: MapEmbedOptions & { userId?: string | null; apiKey?: string | null } = {},
): Promise<MapEmbedResult> {
  return runMapEmbed(
    {
      ...mapEmbedStore(supabase, options.userId ?? null),
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

/** How long embedding after an accept may run. A note has a few dozen rows. */
const AFTER_ACCEPT_MS = 60_000;

/**
 * Embed a person's new rows once the response to their accept has gone.
 *
 * Nothing on the page waits for it. Never throws: a row left unembedded here
 * is picked up by the next cron tick.
 */
export function embedMapRowsAfterResponse(
  supabase: VaultSupabaseClient,
  core: Pick<CoreSupabaseClient, 'from'>,
  userId: string,
): void {
  after(async () => {
    try {
      const result = await embedMapRows(supabase, core, {
        userId,
        deadline: Date.now() + AFTER_ACCEPT_MS,
      });
      if (result.stopped && result.stopped.reason !== 'time') {
        console.error('[vault map embed]', result.stopped.reason, result.stopped.detail);
      }
    } catch (error) {
      console.error('[vault map embed]', error instanceof Error ? error.message : error);
    }
  });
}

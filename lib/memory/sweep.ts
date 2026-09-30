import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import { vectorLiteral } from '@/lib/learn/catalogue/embed-sweep';
import { embedTexts, type EmbedOutcome } from '@/lib/learn/embed/embed';
import { DEFAULT_EMBEDDING_MODEL, type EmbeddingModel } from '@/lib/learn/embed/voyage';
import { cutPassages, type Author } from '@/lib/memory/passages';

/**
 * Keeping core.memory_chunks current (plan #1247).
 *
 * Every five minutes /api/cron/memory-sweep runs this for every account. It
 * first removes the passages of rows that are no longer live
 * (core.prune_memory_chunks), then embeds the rows whose passages are
 * missing, out of date or incomplete (core.stale_memory_sources), cutting
 * each into passages here (lib/memory/passages.ts) and writing them back with
 * core.store_memory_chunks. The first run over an account is the backfill;
 * after that a run finds only what changed since the last one.
 *
 * Which rows count and what their text is are decided in SQL
 * (supabase/migrations/0136_memory_sweep.sql), and so is the hash. This file
 * never builds either, so the staleness check and the write cannot disagree.
 *
 * Spend is recorded per account as `embed-memory`. A round of embedding
 * holds one owner's rows only.
 */

export const OPERATION = 'embed-memory';

/** Rows per read. A read costs about 1.4 seconds whatever its size. */
const DEFAULT_READ = 64;

/**
 * Passages per embedding round. Voyage takes 128 texts a request; a row with
 * more than this goes in a round of its own.
 */
const DEFAULT_ROUND = 128;

/**
 * Passages per write. A vector is about 12,000 characters as a literal, so
 * this keeps one request under a megabyte. A longer row is written over
 * several calls; chunk_count lets the next read see one cut short.
 */
const DEFAULT_WRITE = 64;

export type StaleSource = {
  userId: string;
  sourceTable: string;
  sourceRef: string;
  title: string | null;
  mine: string | null;
  dash: string | null;
  sourceHash: string;
};

export type ChunkWrite = {
  userId: string;
  sourceTable: string;
  sourceRef: string;
  sourceHash: string;
  chunkCount: number;
  model: string;
  /** Remove every passage the row had before writing these. */
  replace: boolean;
  chunks: { chunkIndex: number; author: Author; body: string; vector: number[] }[];
};

export type MemorySweepPorts = {
  prune(): Promise<number>;
  stale(limit: number): Promise<StaleSource[]>;
  store(rows: ChunkWrite[]): Promise<number>;
  embed(input: {
    texts: string[];
    model: EmbeddingModel;
    onSpend: (report: SpendReport) => void;
  }): Promise<EmbedOutcome>;
  ledger?(userId: string, report: SpendReport): Promise<void>;
};

export type MemorySweepOptions = {
  model?: EmbeddingModel;
  read?: number;
  round?: number;
  write?: number;
  /** A time, in epoch milliseconds, after which no further round is started. */
  deadline?: number;
  now?: () => number;
};

export type MemorySweepResult = {
  pruned: number;
  rows: number;
  passages: number;
  calls: number;
  tokens: number;
  /** Why it stopped with rows still to embed, or null if it finished. */
  stopped: { reason: string; detail: string } | null;
};

type Prepared = StaleSource & { passages: { author: Author; body: string }[] };

/** Split prepared rows into rounds: one owner, at most `size` passages, or one long row. */
export function rounds(rows: Prepared[], size: number): Prepared[][] {
  const out: Prepared[][] = [];
  let current: Prepared[] = [];
  let count = 0;
  for (const row of rows) {
    const changesOwner = current.length > 0 && current[0].userId !== row.userId;
    if (current.length > 0 && (changesOwner || count + row.passages.length > size)) {
      out.push(current);
      current = [];
      count = 0;
    }
    current.push(row);
    count += row.passages.length;
  }
  if (current.length > 0) out.push(current);
  return out;
}

/** The writes for one embedded round, a long row split across several. */
export function writesFor(
  round: Prepared[],
  vectors: number[][],
  model: string,
  size: number,
): ChunkWrite[][] {
  const calls: ChunkWrite[][] = [];
  let current: ChunkWrite[] = [];
  let count = 0;
  let offset = 0;

  for (const row of round) {
    const chunks = row.passages.map((passage, index) => ({
      chunkIndex: index,
      author: passage.author,
      body: passage.body,
      vector: vectors[offset + index],
    }));
    offset += row.passages.length;

    for (let from = 0; from < chunks.length; from += size) {
      const slice = chunks.slice(from, from + size);
      if (current.length > 0 && count + slice.length > size) {
        calls.push(current);
        current = [];
        count = 0;
      }
      current.push({
        userId: row.userId,
        sourceTable: row.sourceTable,
        sourceRef: row.sourceRef,
        sourceHash: row.sourceHash,
        chunkCount: chunks.length,
        model,
        replace: from === 0,
        chunks: slice,
      });
      count += slice.length;
    }
  }
  if (current.length > 0) calls.push(current);
  return calls;
}

/**
 * The loop, over the ports.
 *
 * Stops on: nothing left, the deadline, an embedding failure, and a read
 * that wrote nothing, which keeps a row that cannot be written from being
 * embedded again and again within one run.
 */
export async function runMemorySweep(
  ports: MemorySweepPorts,
  options: MemorySweepOptions = {},
): Promise<MemorySweepResult> {
  const model = options.model ?? DEFAULT_EMBEDDING_MODEL;
  const readSize = Math.max(1, options.read ?? DEFAULT_READ);
  const roundSize = Math.max(1, options.round ?? DEFAULT_ROUND);
  const writeSize = Math.max(1, options.write ?? DEFAULT_WRITE);
  const now = options.now ?? Date.now;
  const late = () => options.deadline !== undefined && now() >= options.deadline;

  const result: MemorySweepResult = {
    pruned: await ports.prune(),
    rows: 0,
    passages: 0,
    calls: 0,
    tokens: 0,
    stopped: null,
  };

  for (;;) {
    if (late()) {
      if ((await ports.stale(1)).length > 0) {
        result.stopped = { reason: 'time', detail: 'ran out of time with rows still to embed' };
      }
      return result;
    }

    const read = await ports.stale(readSize);
    if (read.length === 0) return result;

    const prepared: Prepared[] = read
      .map((row) => ({ ...row, passages: cutPassages({ title: row.title, mine: row.mine, dash: row.dash }) }))
      .filter((row) => row.passages.length > 0);

    let writtenThisRead = 0;
    for (const round of rounds(prepared, roundSize)) {
      if (late()) break;

      const owner = round[0].userId;
      const texts = round.flatMap((row) => row.passages.map((passage) => passage.body));
      const reports: SpendReport[] = [];
      const outcome = await ports.embed({ texts, model, onSpend: (report) => reports.push(report) });

      result.calls += reports.length;
      result.tokens += outcome.tokens;
      for (const report of reports) await ports.ledger?.(owner, report);

      if (!outcome.ok) {
        result.stopped = { reason: outcome.reason, detail: outcome.detail };
        return result;
      }
      if (outcome.vectors.length !== texts.length) {
        // embedTexts returns one vector per text or none. Checked anyway: a
        // short list would give passages each other's vectors.
        result.stopped = {
          reason: 'malformed',
          detail: `${outcome.vectors.length} vectors for ${texts.length} passages`,
        };
        return result;
      }

      for (const call of writesFor(round, outcome.vectors, outcome.model, writeSize)) {
        writtenThisRead += await ports.store(call);
      }
      result.rows += round.length;
      result.passages += texts.length;
    }

    if (writtenThisRead === 0 && !late()) {
      result.stopped = {
        reason: 'unchanged',
        detail: `${read.length} rows were read and nothing was written`,
      };
      return result;
    }
  }
}

type StaleRpcRow = {
  user_id: string;
  source_table: string;
  source_ref: string;
  title: string | null;
  my_text: string | null;
  dash_text: string | null;
  source_hash: string;
};

/** The ports over a core client. RLS applies when it is a session client. */
export function memorySweepStore(
  core: Pick<CoreSupabaseClient, 'rpc'>,
  userId: string | null,
): Pick<MemorySweepPorts, 'prune' | 'stale' | 'store'> {
  return {
    async prune() {
      const { data, error } = await core.rpc('prune_memory_chunks', { p_user_id: userId });
      if (error) throw new Error(`Removing passages of gone rows failed: ${error.message}`);
      return typeof data === 'number' ? data : 0;
    },

    async stale(limit) {
      const { data, error } = await core.rpc('stale_memory_sources', {
        p_limit: limit,
        p_user_id: userId,
      });
      if (error) throw new Error(`Reading rows to embed failed: ${error.message}`);
      return ((data ?? []) as StaleRpcRow[]).map((row) => ({
        userId: row.user_id,
        sourceTable: row.source_table,
        sourceRef: row.source_ref,
        title: row.title,
        mine: row.my_text,
        dash: row.dash_text,
        sourceHash: row.source_hash,
      }));
    },

    async store(rows) {
      if (rows.length === 0) return 0;
      const { data, error } = await core.rpc('store_memory_chunks', {
        p_rows: rows.map((row) => ({
          user_id: row.userId,
          source_table: row.sourceTable,
          source_ref: row.sourceRef,
          source_hash: row.sourceHash,
          chunk_count: row.chunkCount,
          model: row.model,
          replace: row.replace,
          chunks: row.chunks.map((chunk) => ({
            chunk_index: chunk.chunkIndex,
            author: chunk.author,
            body: chunk.body,
            embedding: vectorLiteral(chunk.vector),
          })),
        })),
      });
      if (error) throw new Error(`Writing passages failed: ${error.message}`);
      return typeof data === 'number' ? data : 0;
    },
  };
}

/**
 * Prune and embed. `userId` null means every account, which only a service
 * client can see. Spend rows go through the same client.
 */
export async function sweepMemory(
  core: Pick<CoreSupabaseClient, 'rpc' | 'from'>,
  options: MemorySweepOptions & { userId?: string | null; apiKey?: string | null } = {},
): Promise<MemorySweepResult> {
  return runMemorySweep(
    {
      ...memorySweepStore(core, options.userId ?? null),
      embed: ({ texts, model, onSpend }) =>
        embedTexts({ texts, model, inputType: 'document', apiKey: options.apiKey, onSpend }),
      ledger: async (owner, report) => {
        await recordSpend(core, owner, {
          module: 'core',
          operation: OPERATION,
          model: report.model,
          usage: report.usage,
        });
      },
    },
    options,
  );
}

import 'server-only';

import type postgres from 'postgres';
import { costMicrosFor, type SpendReport } from '@/lib/core/spend/pricing';
import { embedTexts, type EmbedOutcome } from '@/lib/learn/embed/embed';
import {
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  type EmbeddingModel,
} from '@/lib/learn/embed/voyage';
import type { LearnOperation } from '@/lib/learn/spend';

/**
 * Giving a vector to every segment that has none.
 *
 * The work to do is defined by the absence of an embedding rather than by a
 * cursor or a queue. `catalogue_segments_unembedded_idx` is the list, a
 * segment leaves it the moment its vector is written, and a run that dies
 * halfway leaves the rest of the list exactly where the next run will look for
 * it. That also means a provider added later needs no change here: whatever
 * writes segments leaves them unembedded, and this picks them up.
 *
 * Privileged, like the rest of lib/learn/catalogue: a `postgres` connection
 * rather than a session client, because the catalogue tables carry no user id
 * and have no insert policy. The one row here that does belong to a person is
 * the spend row, and #741 settled whose it is -- the account that runs the
 * sweep. It is written through the same connection rather than through a
 * Supabase client, so the sweep needs no service-role key beyond the database
 * credentials it already holds; `recordSpend` is the same insert through RLS,
 * and this is that insert with the owner named explicitly.
 *
 * A segment marked not searchable (lib/learn/catalogue/searchable.ts) is
 * never read here: a stub section or a link list stays without a vector for
 * good, which is what keeps it out of every claim's candidates.
 *
 * Two rules the caller can rely on.
 *
 * **A segment is only given a vector for the text it still has.** The write
 * matches on the text that was read, so a segment rewritten by a re-sweep
 * between the read and the write keeps its null and is embedded next time,
 * rather than being handed a vector for a paragraph that is no longer there.
 * That is the same thing `storeArticle` does when it clears an embedding whose
 * text changed, seen from the other end.
 *
 * **It stops at the first failure with everything before it written.** No
 * rollback of the chunks that succeeded, because there is nothing wrong with
 * them and redoing them costs money. A rate limit is already a wait rather
 * than a failure inside `embedTexts`, so reaching this means the provider is
 * down, the key is wrong, or the run is out of attempts.
 */

/** Where the spend lands, for the screen that groups by operation. */
const OPERATION: LearnOperation = 'embed-catalogue';

/**
 * Segments read per chunk.
 *
 * Below the provider's 128 ceiling on purpose. `embedTexts` splits again on
 * total characters, and article sections are long enough that a chunk of 128
 * usually becomes two requests; at 64 it is usually one, so a failure costs
 * one request's tokens rather than stranding the vectors of a request that
 * already succeeded.
 */
const DEFAULT_CHUNK = 64;

export type UnembeddedSegment = { id: string; text: string };

export type EmbeddedSegment = UnembeddedSegment & { vector: number[]; model: string };

/**
 * The two statements this needs, named so a test can hand in its own.
 *
 * A port rather than a stubbed `postgres` tag: the part worth testing is the
 * loop -- that it stops, that it does not redo what it did, that a failure
 * leaves the written rows written -- and none of that is about SQL.
 */
export type SegmentStore = {
  /** At most `limit` searchable segments with no embedding. */
  unembedded(limit: number): Promise<UnembeddedSegment[]>;
  /** Write the vectors whose segment still has the text it was read with. */
  store(rows: EmbeddedSegment[]): Promise<number>;
};

export type EmbedCall = (input: {
  texts: string[];
  model: EmbeddingModel;
  onSpend: (report: SpendReport) => void;
}) => Promise<EmbedOutcome>;

export type SweepPorts = {
  store: SegmentStore;
  embed: EmbedCall;
  /** Told what each call cost. Absent when nobody has been named to bill. */
  ledger?: (report: SpendReport) => Promise<void>;
};

export type EmbedSweepOptions = {
  model?: EmbeddingModel;
  /** Segments per read, and per embedding call in the ordinary case. */
  chunk?: number;
  /** Stop after this many segments, for a first run somebody is watching. */
  limit?: number;
  /**
   * A time, in epoch milliseconds, after which no further chunk is started.
   * For a caller inside a function with a time limit, which needs to say how
   * far it got rather than be cut off halfway. It stops with reason `time`.
   */
  deadline?: number;
  /** The clock the deadline is read against. Date.now unless a test sets it. */
  now?: () => number;
};

export type EmbedSweepResult = {
  /** Segments that now have a vector. */
  embedded: number;
  /**
   * Vectors thrown away because the segment had been rewritten since it was
   * read. The next pass reads the new text and embeds that, so a segment can
   * be counted here and, once it lands, in `embedded` as well.
   */
  skipped: number;
  /** Calls the provider charged for, including any whose answer was unusable. */
  calls: number;
  tokens: number;
  /** What produced the vectors, as the provider named it. */
  model: string | null;
  /** Why it stopped early, or null if it ran out of segments. */
  stopped: { reason: string; detail: string } | null;
};

/** Postgres wants `[1,2,3]`, and a vector of the wrong width fails the cast. */
export function vectorLiteral(vector: number[]): string {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Expected ${EMBEDDING_DIMENSIONS} dimensions, got ${vector.length}.`);
  }
  return `[${vector.join(',')}]`;
}

/**
 * The real statements.
 *
 * Read in `(item_id, ordinal)` order, which is the order the partial index
 * holds and also keeps one article's sections together in a chunk, so a run
 * that stops early has finished whole articles rather than a little of each.
 */
export function segmentStore(sql: postgres.Sql): SegmentStore {
  return {
    async unembedded(limit) {
      // A section cut into passages is searched by its passages, so its own
      // vector would never be read (learn migration 0070). Only the article
      // sections stored before passages existed, and lecture segments, are
      // embedded here.
      return sql<UnembeddedSegment[]>`
        select s.id, s.text
          from learn.catalogue_segments s
         where s.embedding is null and s.searchable
           and not exists (select 1 from learn.catalogue_passages p where p.segment_id = s.id)
         order by s.item_id, s.ordinal
         limit ${limit}`;
    },

    async store(rows) {
      if (rows.length === 0) return 0;

      const ids = rows.map((row) => row.id);
      const texts = rows.map((row) => row.text);
      const vectors = rows.map((row) => vectorLiteral(row.vector));
      const models = rows.map((row) => row.model);

      const written = await sql<{ id: string }[]>`
        update learn.catalogue_segments as s
           set embedding = v.embedding::extensions.vector,
               embedding_model = v.model,
               -- When this segment became findable, which is what the read
               -- button compares against the claim's last search to decide
               -- whether there is anything new to judge.
               embedded_at = now()
          from unnest(${ids}::uuid[], ${texts}::text[], ${vectors}::text[], ${models}::text[])
               as v(id, text, embedding, model)
         where s.id = v.id and s.text = v.text and s.searchable
        returning s.id`;

      return written.length;
    },
  };
}

/**
 * The same two statements over `learn.catalogue_passages` (plan #1132).
 *
 * Read in `(segment_id, ordinal)` order, the partial index's, and written only
 * while the passage still has the text it was read with, as the segments are.
 */
export function passageStore(sql: postgres.Sql): SegmentStore {
  return {
    async unembedded(limit) {
      return sql<UnembeddedSegment[]>`
        select id, text
          from learn.catalogue_passages
         where embedding is null
         order by segment_id, ordinal
         limit ${limit}`;
    },

    async store(rows) {
      if (rows.length === 0) return 0;

      const ids = rows.map((row) => row.id);
      const texts = rows.map((row) => row.text);
      const vectors = rows.map((row) => vectorLiteral(row.vector));
      const models = rows.map((row) => row.model);

      const written = await sql<{ id: string }[]>`
        update learn.catalogue_passages as p
           set embedding = v.embedding::extensions.vector,
               embedding_model = v.model,
               embedded_at = now()
          from unnest(${ids}::uuid[], ${texts}::text[], ${vectors}::text[], ${models}::text[])
               as v(id, text, embedding, model)
         where p.id = v.id and p.text = v.text
        returning p.id`;

      return written.length;
    },
  };
}

/**
 * Two stores read as one: everything the first has to embed, then the second.
 *
 * How one sweep embeds segments and passages under one limit, one deadline
 * and one result. Each row goes back to the store it was read from, told
 * apart by id (both tables key on uuids, so an id is in one or the other).
 */
export function combinedStore(first: SegmentStore, second: SegmentStore): SegmentStore {
  const fromSecond = new Set<string>();
  return {
    async unembedded(limit) {
      const head = await first.unembedded(limit);
      if (head.length >= limit) return head;
      const tail = await second.unembedded(limit - head.length);
      for (const row of tail) fromSecond.add(row.id);
      return [...head, ...tail];
    },

    async store(rows) {
      const toSecond = rows.filter((row) => fromSecond.has(row.id));
      const toFirst = rows.filter((row) => !fromSecond.has(row.id));
      for (const row of toSecond) fromSecond.delete(row.id);
      return (await first.store(toFirst)) + (await second.store(toSecond));
    },
  };
}

/**
 * One spend row per embedding call, under the account running the sweep.
 *
 * Never throws, for the reason `recordSpend` gives: the ledger measures work
 * that already happened, and losing a measurement must not lose the sweep.
 */
export function catalogueLedger(
  sql: postgres.Sql,
  userId: string,
): (report: SpendReport) => Promise<void> {
  return async (report) => {
    try {
      await sql`
        insert into core.model_spend
          (user_id, module, operation, model, input_tokens, cached_input_tokens,
           cache_write_tokens, output_tokens, cost_micros)
        values (${userId}, 'learn', ${OPERATION}, ${report.model},
                ${report.usage.inputTokens}, ${report.usage.cachedInputTokens},
                ${report.usage.cacheWriteTokens}, ${report.usage.outputTokens},
                ${costMicrosFor(report.model, report.usage)})`;
    } catch (error) {
      console.error('[core.model_spend] learn/embed-catalogue', error instanceof Error ? error.message : error);
    }
  };
}

/**
 * The loop, over the two ports.
 *
 * It stops on four things: nothing left to embed, the limit, the deadline,
 * and a chunk that wrote nothing. The last one is what keeps a re-sweep racing this run from
 * spinning: the same rows would be read again, and a chunk where every write
 * was refused has made no progress to build on.
 */
export async function runEmbedSweep(
  ports: SweepPorts,
  options: EmbedSweepOptions = {},
): Promise<EmbedSweepResult> {
  const model = options.model ?? DEFAULT_EMBEDDING_MODEL;
  const chunk = Math.max(1, options.chunk ?? DEFAULT_CHUNK);
  const limit = options.limit ?? null;
  const now = options.now ?? Date.now;

  const result: EmbedSweepResult = {
    embedded: 0,
    skipped: 0,
    calls: 0,
    tokens: 0,
    model: null,
    stopped: null,
  };

  for (;;) {
    const remaining = limit === null ? chunk : Math.min(chunk, limit - result.embedded - result.skipped);
    if (remaining <= 0) break;

    const segments = await ports.store.unembedded(remaining);
    if (segments.length === 0) break;

    // Checked after the read rather than before it, so a run that has nothing
    // left to embed ends clean instead of reporting that it ran out of time.
    if (options.deadline !== undefined && now() >= options.deadline) {
      result.stopped = {
        reason: 'time',
        detail: 'the press ran out of time with segments still to embed',
      };
      break;
    }

    const reports: SpendReport[] = [];
    const outcome = await ports.embed({
      texts: segments.map((segment) => segment.text),
      model,
      onSpend: (report) => reports.push(report),
    });

    result.calls += reports.length;
    result.tokens += outcome.tokens;
    for (const report of reports) await ports.ledger?.(report);

    if (!outcome.ok) {
      result.stopped = { reason: outcome.reason, detail: outcome.detail };
      break;
    }

    if (outcome.vectors.length !== segments.length) {
      // Cannot happen through `embedTexts`, which returns one vector per text
      // or none at all. Checked anyway because the failure it would cause is
      // a segment holding the vector of a different segment, which retrieves
      // plausible neighbours for the wrong text and never throws.
      result.stopped = {
        reason: 'malformed',
        detail: `${outcome.vectors.length} vectors for ${segments.length} segments`,
      };
      break;
    }

    result.model = outcome.model;
    const written = await ports.store.store(
      segments.map((segment, index) => ({
        ...segment,
        vector: outcome.vectors[index],
        model: outcome.model,
      })),
    );

    result.embedded += written;
    result.skipped += segments.length - written;
    if (written === 0) {
      result.stopped = {
        reason: 'unchanged',
        detail: `${segments.length} segments were rewritten while they were being embedded`,
      };
      break;
    }
  }

  return result;
}

/**
 * Embed every segment and every article passage that has none, against the
 * live catalogue. Segments come first, then passages, under the one limit.
 *
 * `userId` is the account the spend goes to. Null writes no ledger row, which
 * is for a caller that has no account to name rather than a way to embed for
 * free: the tokens are spent either way and the run still reports them.
 */
export async function embedCatalogueSegments(
  sql: postgres.Sql,
  options: EmbedSweepOptions & { userId: string | null; apiKey?: string | null } = { userId: null },
): Promise<EmbedSweepResult> {
  return runEmbedSweep(
    {
      store: combinedStore(segmentStore(sql), passageStore(sql)),
      embed: ({ texts, model, onSpend }) =>
        embedTexts({ texts, model, inputType: 'document', apiKey: options.apiKey, onSpend }),
      ledger: options.userId ? catalogueLedger(sql, options.userId) : undefined,
    },
    options,
  );
}

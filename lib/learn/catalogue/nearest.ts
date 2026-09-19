import 'server-only';

import type { SpendSink } from '@/lib/core/spend/pricing';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { vectorLiteral } from '@/lib/learn/catalogue/embed-sweep';
import { embedOne } from '@/lib/learn/embed/embed';
import {
  DEFAULT_EMBEDDING_MODEL,
  type EmbeddingClient,
  type EmbeddingModel,
} from '@/lib/learn/embed/voyage';

/**
 * The segments nearest one claim.
 *
 * Candidate generation, in the sense docs/LEARN-SOURCES-SPEC.md gives it: the
 * claim is embedded, the catalogue is searched by cosine similarity, and what
 * comes back is a short list with a number on each saying how close it is.
 * Nothing here decides that a segment teaches a claim. That is the judging
 * pass above this, which reads the segment text and has to argue for it before
 * a link is written.
 *
 * Three things this guarantees its caller.
 *
 * **The claim is embedded as a query, not as a document.** Voyage prepends a
 * different instruction to each, and a claim embedded as a document is
 * compared against documents embedded the same way, which degrades retrieval
 * without failing. The catalogue sweep passes `document`; everything on this
 * side passes `query`.
 *
 * **Nothing below the floor comes back.** A claim the catalogue does not cover
 * returns an empty list rather than the forty least bad neighbours, because
 * every segment that survives this costs one model call in the judging pass.
 * The floor is applied in the database, where it saves sending the text, and
 * again here, so the guarantee holds whichever index answered.
 *
 * **Which model embedded what is visible.** All three Voyage models share one
 * embedding space, so a claim embedded by one is comparable to a catalogue
 * embedded by another and there is no reason to refuse those rows. A catalogue
 * embedded half by Voyage and half by something else is a different matter and
 * is not something this can detect on its own, so the models that answered are
 * returned alongside the segments and a caller that wants one can filter.
 */

/**
 * Candidates per claim, before the floor.
 *
 * Forty is what the spec asks for. It is also the ceiling on what one press
 * can cost: every candidate above the floor is one judging call, so this is
 * the number that bounds the bill when the floor turns out to be too
 * permissive for the catalogue as it actually embeds.
 */
export const DEFAULT_CANDIDATE_LIMIT = 40;

/**
 * How close a segment has to be to be worth reading.
 *
 * A starting point rather than a measurement. Nothing in this database has
 * been embedded yet, so there is no distribution to set it from, and the
 * number that separates a segment about this claim from a segment about the
 * same general subject is a property of the embedding model rather than of
 * this code. Erring strict is the cheaper mistake of the two: a floor set too
 * high shows a claim with material as a claim with none, which is a state the
 * page names and somebody can act on, while a floor set too low pays for forty
 * judging calls on every claim the catalogue was never going to cover.
 *
 * The first real catalogue is what settles it. It is a parameter everywhere
 * below so that moving it is a caller's change rather than a migration.
 */
export const DEFAULT_MIN_SIMILARITY = 0.5;

/** One candidate, with enough of its work to judge it and to show it. */
export type NearbySegment = {
  segmentId: string;
  itemId: string;
  ordinal: number;
  /** What a card shows for an article section. Null on a timed segment. */
  heading: string | null;
  /** The fragment that addresses the section. Null on a timed segment. */
  sectionAnchor: string | null;
  tStartSeconds: number | null;
  tEndSeconds: number | null;
  text: string;
  /** What embedded this segment, which is not always what embedded the claim. */
  embeddingModel: string;
  /** Cosine, 1 for the same direction and 0 for an unrelated one. */
  similarity: number;
  item: { title: string; kind: string; canonicalUrl: string };
};

/**
 * The one read this needs, named so a test can hand in its own.
 *
 * A port rather than a stubbed client, for the reason the sweep beside this
 * gives. What a test should hold still is what the caller was promised:
 * closest first, nothing below the floor, and nothing at all when nothing is
 * close. None of that is about SQL. The live implementation is the RPC below,
 * and the SQL it calls was exercised against the real index when this was
 * built.
 */
export type SegmentIndex = {
  nearest(input: {
    vector: number[];
    limit: number;
    minSimilarity: number;
    /** Restrict to a catalogue embedded by one model, or null for all of it. */
    embeddingModel: string | null;
  }): Promise<NearbySegment[]>;
};

/** Embedding one claim. Separated so a test never reaches a network. */
export type EmbedClaim = (input: {
  text: string;
  model: EmbeddingModel;
  onSpend?: SpendSink;
}) => Promise<Awaited<ReturnType<typeof embedOne>>>;

export type NearestPorts = { index: SegmentIndex; embed: EmbedClaim };

type EmbedFailure = Extract<Awaited<ReturnType<typeof embedOne>>, { ok: false }>;

/** Everything `embedOne` can refuse with, plus the read itself failing. */
export type NearestFailureReason = EmbedFailure['reason'] | 'index';

export type NearestOptions = {
  /** Candidates to consider before the floor. */
  limit?: number;
  minSimilarity?: number;
  /** Which model embeds the claim. */
  model?: EmbeddingModel;
  /** Restrict the catalogue side to one model. Null, the default, is all of it. */
  embeddingModel?: string | null;
  onSpend?: SpendSink;
};

export type NearestOutcome =
  | {
      ok: true;
      /** Closest first, each above the floor. Empty when nothing is close. */
      segments: NearbySegment[];
      /** What embedded the claim. */
      model: string;
      /** What embedded the segments that came back, deduplicated. */
      models: string[];
      tokens: number;
    }
  | {
      ok: false;
      reason: NearestFailureReason;
      detail: string;
      /** What the embedding call spent before it failed. Not always zero. */
      tokens: number;
    };

/**
 * The floor and the ordering, over rows that already have their similarity.
 *
 * Pure, and exported because it is the whole of what this module promises:
 * closest first, a similarity on each, and an empty list rather than weak
 * matches. A row whose similarity is not a number is dropped rather than
 * sorted, since it cannot be compared against the floor either.
 */
export function rankNearest(
  segments: NearbySegment[],
  options: { minSimilarity?: number; limit?: number } = {},
): NearbySegment[] {
  const floor = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  const limit = Math.max(0, options.limit ?? DEFAULT_CANDIDATE_LIMIT);

  return segments
    .filter((segment) => Number.isFinite(segment.similarity) && segment.similarity >= floor)
    .sort(
      (left, right) =>
        right.similarity - left.similarity ||
        // The same tiebreak the SQL uses, so two segments at one distance come
        // back in one order and a repeat press shows the same list.
        left.itemId.localeCompare(right.itemId) ||
        left.ordinal - right.ordinal,
    )
    .slice(0, limit);
}

/** What `learn.nearest_catalogue_segments` returns, one row per candidate. */
type NearestRow = {
  segment_id: string;
  item_id: string;
  ordinal: number;
  heading: string | null;
  section_anchor: string | null;
  t_start_seconds: number | null;
  t_end_seconds: number | null;
  segment_text: string;
  embedding_model: string;
  similarity: number;
  item_title: string;
  item_kind: string;
  item_canonical_url: string;
};

function toNearbySegment(row: NearestRow): NearbySegment {
  return {
    segmentId: row.segment_id,
    itemId: row.item_id,
    ordinal: row.ordinal,
    heading: row.heading,
    sectionAnchor: row.section_anchor,
    tStartSeconds: row.t_start_seconds,
    tEndSeconds: row.t_end_seconds,
    text: row.segment_text,
    embeddingModel: row.embedding_model,
    similarity: Number(row.similarity),
    item: {
      title: row.item_title,
      kind: row.item_kind,
      canonicalUrl: row.item_canonical_url,
    },
  };
}

/**
 * The live index, through the session client.
 *
 * A function rather than a select because PostgREST has no way to order by an
 * operator against a vector, which is the whole query. It runs as the caller,
 * and the catalogue's select policy already lets any signed-in account read
 * it, so this widens nothing.
 *
 * The vector goes over as the text Postgres parses into a vector, built by
 * `vectorLiteral`, which refuses anything that is not 1024 wide. That check is
 * worth having on this side: a short vector reaches the database as a cast
 * error with no indication of which caller sent it.
 */
export function rpcSegmentIndex(supabase: LearnSupabaseClient): SegmentIndex {
  return {
    async nearest({ vector, limit, minSimilarity, embeddingModel }) {
      const { data, error } = await supabase.rpc('nearest_catalogue_segments', {
        query_embedding: vectorLiteral(vector),
        match_limit: limit,
        min_similarity: minSimilarity,
        embedding_model_filter: embeddingModel,
      });

      if (error) throw new Error(error.message);
      return ((data ?? []) as NearestRow[]).map(toNearbySegment);
    },
  };
}

/**
 * Embed the claim, then read the index.
 *
 * Never throws. A missing key, a provider that refused and a database that
 * would not answer are all ordinary outcomes for the press above this, which
 * falls back to the web search when the catalogue has nothing to offer, and a
 * caller that has to catch as well as check would eventually forget to.
 */
export async function nearestSegmentsForClaim(
  ports: NearestPorts,
  claim: string,
  options: NearestOptions = {},
): Promise<NearestOutcome> {
  const limit = Math.max(1, options.limit ?? DEFAULT_CANDIDATE_LIMIT);
  const minSimilarity = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;

  const embedded = await ports.embed({
    text: claim,
    model: options.model ?? DEFAULT_EMBEDDING_MODEL,
    onSpend: options.onSpend,
  });

  if (!embedded.ok) {
    return { ok: false, reason: embedded.reason, detail: embedded.detail, tokens: embedded.tokens };
  }

  let found: NearbySegment[];
  try {
    found = await ports.index.nearest({
      vector: embedded.vector,
      limit,
      minSimilarity,
      embeddingModel: options.embeddingModel ?? null,
    });
  } catch (error) {
    return {
      ok: false,
      reason: 'index',
      detail: error instanceof Error ? error.message : String(error),
      // The claim was embedded before the read failed, so this was spent.
      tokens: embedded.tokens,
    };
  }

  const segments = rankNearest(found, { minSimilarity, limit });

  return {
    ok: true,
    segments,
    model: embedded.model,
    models: [...new Set(segments.map((segment) => segment.embeddingModel))],
    tokens: embedded.tokens,
  };
}

/**
 * The segments nearest a claim, against the live catalogue.
 *
 * What a server action calls. Spending is reported through `onSpend` rather
 * than recorded here, because the press that calls this makes the judging
 * calls as well and writes them to the ledger in one go.
 */
export async function findNearestSegments(
  supabase: LearnSupabaseClient,
  claim: string,
  options: NearestOptions & { apiKey?: string | null; client?: EmbeddingClient } = {},
): Promise<NearestOutcome> {
  return nearestSegmentsForClaim(
    {
      index: rpcSegmentIndex(supabase),
      embed: ({ text, model, onSpend }) =>
        embedOne(text, {
          model,
          inputType: 'query',
          apiKey: options.apiKey,
          client: options.client,
          onSpend,
        }),
    },
    claim,
    options,
  );
}

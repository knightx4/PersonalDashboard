import 'server-only';

import { EMPTY_USAGE, type SpendSink } from '@/lib/core/spend/pricing';
import {
  DEFAULT_EMBEDDING_MODEL,
  voyageClient,
  type EmbeddingClient,
  type EmbeddingInputType,
  type EmbeddingModel,
} from '@/lib/learn/embed/voyage';

/**
 * Text in, vectors out, in the quantities the callers actually hold.
 *
 * Nothing in the app changes here. This is what the two steps above it need:
 * the sweep that embeds every segment with no embedding, and the search that
 * embeds one claim to find its nearest segments. Both arrive with a list, so
 * the list is the unit and the provider's batch limit is this module's problem
 * rather than theirs.
 *
 * Two rules the callers depend on.
 *
 * **All of it or none of it.** A run either returns one vector per text, in
 * the order the texts were given, or it returns a failure and no vectors. The
 * alternative -- a short array the caller zips against its own list -- pairs
 * every segment after the gap with the wrong vector, and a wrong vector is
 * invisible: it retrieves plausible neighbours for the wrong text and nothing
 * ever throws.
 *
 * **A rate limit is a wait, not a failure.** The provider asking us to slow
 * down is the expected answer to a sweep of a few thousand segments, so a
 * batch that gets one waits and asks again before giving up.
 *
 * Every call is reported to the spend sink, including the ones whose response
 * came back unusable, for the reason lib/core/spend/pricing gives: a malformed
 * response cost what it cost, and a ledger that omits the failures understates
 * the bill in exactly the case you would want to look at.
 */

/**
 * Texts per request. Voyage documents 128 as the batch ceiling for these
 * models, and a request at the ceiling is the one that is refused when they
 * lower it, so this is what they publish and not one more.
 */
const MAX_BATCH_TEXTS = 128;

/**
 * A second ceiling, on size rather than count. The per-request token limit is
 * the one a batch of long article sections hits first; at roughly four
 * characters to the token this leaves a wide margin under it. A single text
 * longer than this goes on its own and is truncated by the provider.
 */
const MAX_BATCH_CHARS = 320_000;

/** Attempts per batch, including the first. */
const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export type EmbedInput = {
  texts: string[];
  /** Documents unless the caller is embedding something to search with. */
  inputType?: EmbeddingInputType;
  model?: EmbeddingModel;
  /** Falls back to EMBEDDING_API_KEY, which is what the deployment sets. */
  apiKey?: string | null;
  /** Injected by the tests, so nothing here reaches a network under vitest. */
  client?: EmbeddingClient;
  /** Told what every call cost, whether or not its vectors were usable. */
  onSpend?: SpendSink;
  /** How a backoff waits. Injected so a test does not spend four seconds. */
  sleep?: (ms: number) => Promise<void>;
};

export type EmbedOutcome =
  | {
      ok: true;
      /** One per text, in order, each EMBEDDING_DIMENSIONS long. */
      vectors: number[][];
      /** What produced them, for `catalogue_segments.embedding_model`. */
      model: string;
      tokens: number;
    }
  | {
      ok: false;
      reason: 'no-key' | 'empty-text' | 'rate-limited' | 'refused' | 'malformed' | 'timeout' | 'error';
      detail: string;
      /** What was spent before it gave up. Not zero just because it failed. */
      tokens: number;
    };

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Split a list so that no request exceeds either ceiling.
 *
 * Exported because the batch shape is the part worth testing directly: it is
 * the difference between one sweep and forty, and it is where an off-by-one
 * produces a request the provider refuses.
 */
export function batchTexts(
  texts: string[],
  limits: { maxTexts?: number; maxChars?: number } = {},
): string[][] {
  const maxTexts = limits.maxTexts ?? MAX_BATCH_TEXTS;
  const maxChars = limits.maxChars ?? MAX_BATCH_CHARS;

  const batches: string[][] = [];
  let current: string[] = [];
  let chars = 0;

  for (const text of texts) {
    const wouldOverflow = current.length >= maxTexts || (current.length > 0 && chars + text.length > maxChars);
    if (wouldOverflow) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(text);
    chars += text.length;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

/** Doubling, capped, and overridden by whatever the provider asked for. */
function backoffFor(attempt: number, asked: number | null): number {
  const ours = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  if (asked === null) return ours;
  return Math.min(Math.max(asked, 0), MAX_BACKOFF_MS);
}

/**
 * Embed a list of texts.
 *
 * Never throws. The key being unset is an ordinary answer here, not a crash:
 * the catalogue sweep runs on a machine that may not have one, and it should
 * say so and leave the segments unembedded for the next run.
 */
export async function embedTexts(input: EmbedInput): Promise<EmbedOutcome> {
  const model = input.model ?? DEFAULT_EMBEDDING_MODEL;
  const inputType = input.inputType ?? 'document';
  const sleep = input.sleep ?? wait;

  if (input.texts.length === 0) {
    return { ok: true, vectors: [], model, tokens: 0 };
  }

  const empty = input.texts.findIndex((text) => text.trim() === '');
  if (empty !== -1) {
    // Refused here rather than at the provider, which answers 400 for it. A
    // segment with no text cannot be embedded and the column says so.
    return { ok: false, reason: 'empty-text', detail: `text ${empty} is empty`, tokens: 0 };
  }

  const apiKey = input.apiKey ?? process.env.EMBEDDING_API_KEY ?? null;
  const client = input.client ?? (apiKey ? voyageClient(apiKey) : null);
  if (!client) {
    return {
      ok: false,
      reason: 'no-key',
      detail: 'EMBEDDING_API_KEY is not set on this deployment',
      tokens: 0,
    };
  }

  const vectors: number[][] = [];
  let tokens = 0;
  let produced: string = model;

  for (const batch of batchTexts(input.texts)) {
    for (let attempt = 1; ; attempt += 1) {
      const result = await client({ texts: batch, model, inputType });

      // Anything that got a response body is reported, including one that did
      // not parse. A 429 and a dropped connection are charged for nothing.
      if (result.ok || result.tokens > 0) {
        tokens += result.tokens;
        input.onSpend?.({
          model: result.ok ? result.model : model,
          usage: { ...EMPTY_USAGE, inputTokens: result.tokens },
        });
      }

      if (result.ok) {
        vectors.push(...result.vectors);
        produced = result.model;
        break;
      }

      const worthRetrying = result.reason === 'rate-limited' || result.reason === 'timeout';
      if (!worthRetrying || attempt >= MAX_ATTEMPTS) {
        // Whatever succeeded before this is dropped on the floor on purpose.
        // Nothing has been written yet, and a caller handed half a list would
        // have no way to tell which half.
        return { ok: false, reason: result.reason, detail: result.detail, tokens };
      }

      await sleep(backoffFor(attempt, result.retryAfterMs));
    }
  }

  return { ok: true, vectors, model: produced, tokens };
}

/**
 * Embed one text, for the callers that have exactly one -- a claim on its way
 * into a nearest-neighbour search.
 */
export async function embedOne(
  text: string,
  options: Omit<EmbedInput, 'texts'> = {},
): Promise<
  { ok: true; vector: number[]; model: string; tokens: number } | Extract<EmbedOutcome, { ok: false }>
> {
  const outcome = await embedTexts({ ...options, texts: [text] });
  if (!outcome.ok) return outcome;
  return { ok: true, vector: outcome.vectors[0], model: outcome.model, tokens: outcome.tokens };
}

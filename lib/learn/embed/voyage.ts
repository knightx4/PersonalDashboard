import 'server-only';

import { z } from 'zod';

/**
 * One call to Voyage, and the only place this app knows how their API is
 * shaped.
 *
 * Decision #724 chose Voyage as the embedding provider. #726 set the key and
 * narrowed the model to the Voyage 4 family rather than the voyage-3.5 models
 * named when the decision was written: voyage-4-lite, voyage-4 and
 * voyage-4-large share one embedding space, so a catalogue embedded by the
 * lite model can be re-embedded by the large one without the vectors becoming
 * incomparable mid-sweep.
 *
 * Fetched directly rather than through lib/learn/providers. That module exists
 * because the locate pass fetches an address a model produced from text a
 * stranger wrote, which is a request-forgery surface; this is a POST to one
 * host we chose, with our own key on it, the same as Gmail and GitHub and eBay
 * elsewhere in this codebase. It also could not go through `fetchDocument`,
 * which only does GETs.
 *
 * `output_dimension` is sent explicitly even though 1024 is the family
 * default. `learn.catalogue_segments.embedding` is `vector(1024)`, a vector of
 * another width fails the insert several files away from here, and a default
 * is a thing a provider is entitled to change.
 */

/** The three models that share one embedding space. Cheapest first. */
export const EMBEDDING_MODELS = ['voyage-4-lite', 'voyage-4', 'voyage-4-large'] as const;

export type EmbeddingModel = (typeof EMBEDDING_MODELS)[number];

/** Where to start, per #726. */
export const DEFAULT_EMBEDDING_MODEL: EmbeddingModel = 'voyage-4-lite';

/** The width `learn.catalogue_segments.embedding` commits to. */
export const EMBEDDING_DIMENSIONS = 1024;

const ENDPOINT = 'https://api.voyageai.com/v1/embeddings';
const TIMEOUT_MS = 30_000;

/**
 * Which side of the retrieval a text is on.
 *
 * Voyage prepends a different instruction to each, and the pair is what their
 * retrieval numbers are measured with. The catalogue sweep embeds documents;
 * the search in #731 embeds the claim as a query. Getting this wrong does not
 * fail, it just retrieves slightly worse, which is the kind of mistake nobody
 * finds later.
 */
export type EmbeddingInputType = 'document' | 'query';

export type EmbeddingRequest = {
  texts: string[];
  model: EmbeddingModel;
  inputType: EmbeddingInputType;
};

export type EmbeddingBatch = {
  ok: true;
  /** One vector per text, in the order the texts were given. */
  vectors: number[][];
  /** What the provider says produced them, for `embedding_model`. */
  model: string;
  tokens: number;
};

export type EmbeddingFailure = {
  ok: false;
  /**
   * `rate-limited` and `timeout` are worth asking again about. `refused` is a
   * bad key or a request this account may not make, and `malformed` is a
   * response that did not parse; neither improves on a second attempt.
   */
  reason: 'rate-limited' | 'refused' | 'malformed' | 'timeout' | 'error';
  detail: string;
  /** What the provider said it charged, when it got far enough to say. */
  tokens: number;
  /** From `Retry-After`, when the provider gave one. */
  retryAfterMs: number | null;
};

export type EmbeddingResult = EmbeddingBatch | EmbeddingFailure;

/**
 * Anything that turns texts into vectors. The tests hand in their own, so no
 * test in this module reaches a network.
 */
export type EmbeddingClient = (request: EmbeddingRequest) => Promise<EmbeddingResult>;

function fail(
  reason: EmbeddingFailure['reason'],
  detail: string,
  extra: { tokens?: number; retryAfterMs?: number | null } = {},
): EmbeddingFailure {
  return {
    ok: false,
    reason,
    detail,
    tokens: extra.tokens ?? 0,
    retryAfterMs: extra.retryAfterMs ?? null,
  };
}

const responseSchema = z.object({
  data: z.array(z.object({ embedding: z.array(z.number()), index: z.number().int().min(0) })),
  model: z.string().optional(),
  usage: z.object({ total_tokens: z.number() }).optional(),
});

/**
 * `Retry-After` is seconds or an HTTP date. Both are read; anything else is
 * treated as absent, because a backoff we invented is better than one we
 * misread.
 */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) return seconds > 0 ? Math.round(seconds * 1000) : 0;

  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

/**
 * Turn the response body into vectors, or say why it cannot be.
 *
 * Exported so the checks can be read on their own. Two of them matter: the
 * provider must return exactly as many vectors as texts it was given, and each
 * must be the width the column takes. A short batch silently mis-pairs every
 * vector after the gap with the wrong segment, which is the failure that would
 * be hardest to see and impossible to undo.
 */
export function parseEmbeddingResponse(body: unknown, expected: number): EmbeddingResult {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) return fail('malformed', 'response did not have the documented shape');

  const tokens = Math.max(0, Math.round(parsed.data.usage?.total_tokens ?? 0));
  const model = parsed.data.model?.trim() || '';

  if (parsed.data.data.length !== expected) {
    return fail('malformed', `asked for ${expected} vectors, got ${parsed.data.data.length}`, {
      tokens,
    });
  }

  const vectors: number[][] = new Array(expected);
  for (const row of parsed.data.data) {
    if (row.index >= expected || vectors[row.index] !== undefined) {
      return fail('malformed', `vector index ${row.index} is out of range or repeated`, { tokens });
    }
    if (row.embedding.length !== EMBEDDING_DIMENSIONS) {
      return fail(
        'malformed',
        `vector ${row.index} has ${row.embedding.length} dimensions, not ${EMBEDDING_DIMENSIONS}`,
        { tokens },
      );
    }
    if (row.embedding.some((value) => !Number.isFinite(value))) {
      return fail('malformed', `vector ${row.index} contains a value that is not a number`, {
        tokens,
      });
    }
    vectors[row.index] = row.embedding;
  }

  if (!model) return fail('malformed', 'response did not name the model that produced it', { tokens });

  return { ok: true, vectors, model, tokens };
}

/** The body sent to Voyage. Exported so a test can read it without a network. */
export function embeddingRequestBody(request: EmbeddingRequest): Record<string, unknown> {
  return {
    input: request.texts,
    model: request.model,
    input_type: request.inputType,
    output_dimension: EMBEDDING_DIMENSIONS,
    // A section longer than the context window is cut rather than refused,
    // which is the right answer for a sweep: the head of a long article
    // section is still the best short statement of what it is about.
    truncation: true,
  };
}

/**
 * A client bound to one API key.
 *
 * Never throws. Every way this can go wrong is an ordinary outcome the caller
 * has to decide about, and an exception thrown out of a batch halfway through
 * a sweep is the shape that loses work.
 */
export function voyageClient(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): EmbeddingClient {
  return async (request) => {
    let response: Response;
    try {
      response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(embeddingRequestBody(request)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      const detail = error instanceof Error ? error.message : 'request failed';
      return fail(timedOut ? 'timeout' : 'error', detail);
    }

    if (response.status === 429) {
      return fail('rate-limited', 'the provider asked us to slow down', {
        retryAfterMs: retryAfterMs(response.headers.get('retry-after')),
      });
    }
    if (response.status === 401 || response.status === 403) {
      return fail('refused', `${response.status}: the key was not accepted`);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return fail(
        response.status >= 500 ? 'error' : 'refused',
        `${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return fail('malformed', 'response was not JSON');
    }

    return parseEmbeddingResponse(body, request.texts.length);
  };
}

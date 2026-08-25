/**
 * Shared HTTP for book metadata providers.
 *
 * The reason this exists: a quota error and an unknown ISBN are not the same
 * answer, and the providers used to collapse both into an empty result. A
 * keyless Google Books call gets 429 several times a day, and the user was
 * told their book does not exist. Transport failures now travel as
 * ProviderError so the resolver can report "try again" instead of "no match".
 */

export type ProviderFailureKind =
  | 'rate_limited'
  | 'unavailable'
  | 'timeout'
  | 'unauthorized';

export type ProviderFailure = {
  provider: string;
  kind: ProviderFailureKind;
  status?: number;
};

export class ProviderError extends Error {
  constructor(readonly failure: ProviderFailure) {
    super(`${failure.provider}: ${failure.kind}${failure.status ? ` (${failure.status})` : ''}`);
    this.name = 'ProviderError';
  }
}

/** Status codes worth a second attempt — the resource may well be there. */
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Short by design: a book lookup blocks a user staring at a spinner. */
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RETRY_DELAYS_MS = [250, 600];

export type JsonRequestOptions = {
  /** Name used in failure reports. */
  provider: string;
  fetch?: typeof globalThis.fetch;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** One entry per retry; empty disables retrying. */
  retryDelaysMs?: number[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function failureForStatus(provider: string, status: number): ProviderFailure {
  if (status === 429) return { provider, kind: 'rate_limited', status };
  if (status === 401 || status === 403) return { provider, kind: 'unauthorized', status };
  return { provider, kind: 'unavailable', status };
}

/**
 * GET JSON. Returns null when the resource genuinely is not there (404/410),
 * throws ProviderError when the lookup could not be completed.
 */
export async function getJson<T>(
  url: string,
  options: JsonRequestOptions,
): Promise<T | null> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const delays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;

  let lastFailure: ProviderFailure = { provider: options.provider, kind: 'unavailable' };

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1] ?? 0);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn(url, {
        headers: { Accept: 'application/json', ...options.headers },
        signal: controller.signal,
      });

      if (res.status === 404 || res.status === 410) return null;

      if (!res.ok) {
        lastFailure = failureForStatus(options.provider, res.status);
        // An expired key or a blocked app will not fix itself in 250ms.
        if (!RETRYABLE.has(res.status)) throw new ProviderError(lastFailure);
        continue;
      }

      return (await res.json()) as T;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      lastFailure = {
        provider: options.provider,
        kind: controller.signal.aborted ? 'timeout' : 'unavailable',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  throw new ProviderError(lastFailure);
}

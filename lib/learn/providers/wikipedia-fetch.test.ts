import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchResult } from './fetch';

/**
 * Asking again when Wikipedia says too many requests.
 *
 * The Learn now picking pass fetches articles one after another, and the first
 * live run had most of them refused with 429. These hold the retry to what it
 * promises: a 429 is asked again after a wait, twice at most, and any other
 * refusal is reported at once.
 */

const fetchDocument = vi.fn<(url: string) => Promise<FetchResult>>();
vi.mock('./fetch', () => ({ fetchDocument: (url: string) => fetchDocument(url) }));

const { fetchWikipediaArticle, RATE_LIMIT_WAITS_MS } = await import('./wikipedia');

const tooMany: FetchResult = { ok: false, reason: 'error', detail: '429' };
const article: FetchResult = {
  ok: true,
  url: 'https://en.wikipedia.org/w/api.php',
  contentType: 'json',
  text: JSON.stringify({
    query: {
      pages: [
        {
          pageid: 1,
          title: 'Inflation',
          fullurl: 'https://en.wikipedia.org/wiki/Inflation',
          extract: 'Inflation is a general rise in prices.\n\n== Causes ==\nMoney supply and demand.',
        },
      ],
    },
  }),
  bytes: null,
  byteLength: 10,
};

describe('fetchWikipediaArticle when rate limited', () => {
  beforeEach(() => fetchDocument.mockReset());

  it('waits and asks again after a 429, then returns the article', async () => {
    const waits: number[] = [];
    fetchDocument.mockResolvedValueOnce(tooMany).mockResolvedValueOnce(article);

    const result = await fetchWikipediaArticle('Inflation', { sleep: async (ms) => void waits.push(ms) });

    expect(result.ok).toBe(true);
    expect(fetchDocument).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([RATE_LIMIT_WAITS_MS[0]]);
  });

  it('gives up after the last wait and says why', async () => {
    fetchDocument.mockResolvedValue(tooMany);

    const result = await fetchWikipediaArticle('Inflation', { sleep: async () => {} });

    expect(result.ok).toBe(false);
    expect(fetchDocument).toHaveBeenCalledTimes(RATE_LIMIT_WAITS_MS.length + 1);
    if (!result.ok) expect(result.detail).toContain('429');
  });

  it('does not retry a refusal that is not a 429', async () => {
    fetchDocument.mockResolvedValue({ ok: false, reason: 'not-found', detail: '404' });

    const result = await fetchWikipediaArticle('No such article', { sleep: async () => {} });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
    expect(fetchDocument).toHaveBeenCalledTimes(1);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchResult } from './fetch';

const fetchDocument = vi.fn<(url: string) => Promise<FetchResult>>();
vi.mock('./fetch', () => ({ fetchDocument: (url: string) => fetchDocument(url) }));

const { searchWikipediaTitle, searchRequestUrl } = await import('./wikipedia-search');

const answer = (body: unknown): FetchResult => ({
  ok: true,
  url: 'https://en.wikipedia.org/w/api.php',
  contentType: 'json',
  text: JSON.stringify(body),
  bytes: null,
  byteLength: 10,
});

describe('searchWikipediaTitle', () => {
  beforeEach(() => fetchDocument.mockReset());

  it('asks for one main-namespace hit and reads its title', async () => {
    fetchDocument.mockResolvedValueOnce(answer({ query: { search: [{ title: 'Marginal cost' }] } }));
    expect(await searchWikipediaTitle('marginal cost')).toEqual({ ok: true, title: 'Marginal cost' });
    const url = new URL(searchRequestUrl('marginal cost'));
    expect(url.searchParams.get('list')).toBe('search');
    expect(url.searchParams.get('srlimit')).toBe('1');
    expect(url.searchParams.get('srnamespace')).toBe('0');
  });

  it('returns null for no hit', async () => {
    fetchDocument.mockResolvedValueOnce(answer({ query: { search: [] } }));
    expect(await searchWikipediaTitle('zzz')).toEqual({ ok: true, title: null });
  });

  it('asks again after a 429 and reports any other refusal', async () => {
    const sleep = vi.fn(async () => {});
    fetchDocument
      .mockResolvedValueOnce({ ok: false, reason: 'error', detail: '429' })
      .mockResolvedValueOnce(answer({ query: { search: [{ title: 'Inflation' }] } }));
    expect(await searchWikipediaTitle('inflation', { sleep })).toEqual({ ok: true, title: 'Inflation' });
    expect(sleep).toHaveBeenCalledTimes(1);

    fetchDocument.mockResolvedValueOnce({ ok: false, reason: 'error', detail: '500' });
    expect((await searchWikipediaTitle('x', { sleep })).ok).toBe(false);
  });
});

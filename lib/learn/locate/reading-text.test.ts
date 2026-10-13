import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchResult } from '@/lib/learn/providers/fetch';
import { MAX_READING_TEXT } from '@/lib/learn/tracks/reading-text';

const fetchDocument = vi.fn<(url: string) => Promise<FetchResult>>();
const loadReadingText = vi.fn();
vi.mock('@/lib/learn/providers', () => ({ fetchDocument: (u: string) => fetchDocument(u) }));
vi.mock('@/lib/learn/tracks/load', () => ({
  loadReadingText: (...a: unknown[]) => loadReadingText(...a),
}));

const { getReadingText, UNREADABLE_MESSAGE } = await import('./reading-text');
const db = {} as never;
const reading = { id: 'r1', url: 'https://example.com/a' };

function page(text: string, contentType: 'html' | 'pdf' | 'text' = 'html'): FetchResult {
  return { ok: true, url: reading.url, contentType, text, bytes: null, byteLength: text.length };
}

beforeEach(() => {
  fetchDocument.mockReset();
  loadReadingText.mockReset().mockResolvedValue(null);
});

describe('getReadingText', () => {
  it('returns given text and never fetches the link', async () => {
    loadReadingText.mockResolvedValue({ text: 'my words', label: 'Pasted' });
    const r = await getReadingText(db, reading);
    expect(r).toEqual({ ok: true, from: 'given', label: 'Pasted', text: 'my words', truncated: false });
    expect(fetchDocument).not.toHaveBeenCalled();
  });

  it('cuts given text at the cap and says so', async () => {
    loadReadingText.mockResolvedValue({ text: 'x'.repeat(MAX_READING_TEXT + 5), label: 'Pasted' });
    const r = await getReadingText(db, reading);
    expect(r.ok && r.text.length).toBe(MAX_READING_TEXT);
    expect(r.ok && r.truncated).toBe(true);
  });

  it('fetches the link as plain text when nothing was given', async () => {
    fetchDocument.mockResolvedValue(
      page(`<html><body><p>${'word '.repeat(80)}</p><script>x()</script></body></html>`),
    );
    const r = await getReadingText(db, reading);
    expect(r.ok && r.from).toBe('link');
    expect(r.ok && r.text).not.toContain('x()');
    expect(r.ok && r.truncated).toBe(false);
  });

  it('cuts a long page and flags it', async () => {
    fetchDocument.mockResolvedValue(page('a'.repeat(MAX_READING_TEXT + 100), 'text'));
    const r = await getReadingText(db, reading);
    expect(r.ok && r.text.length).toBe(MAX_READING_TEXT);
    expect(r.ok && r.truncated).toBe(true);
  });

  it.each(['blocked', 'not-found', 'timeout', 'too-large', 'unsupported-type', 'error'] as const)(
    'fails clearly when the fetch says %s',
    async (reason) => {
      fetchDocument.mockResolvedValue({ ok: false, reason, detail: 'x' });
      expect(await getReadingText(db, reading)).toEqual({
        ok: false,
        reason,
        message: UNREADABLE_MESSAGE,
      });
    },
  );

  it('fails on a paywall stub with too little text', async () => {
    fetchDocument.mockResolvedValue(page('<p>Subscribe to read</p>'));
    const r = await getReadingText(db, reading);
    expect(!r.ok && r.reason).toBe('too-little-text');
  });

  it('fails on a PDF link and on a reading with no link', async () => {
    fetchDocument.mockResolvedValue(page('', 'pdf'));
    const p = await getReadingText(db, reading);
    expect(!p.ok && p.reason).toBe('pdf');
    const r = await getReadingText(db, { id: 'r1', url: null });
    expect(!r.ok && r.reason).toBe('no-link');
  });
});

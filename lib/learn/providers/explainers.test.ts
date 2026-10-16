import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchResult } from '@/lib/learn/providers/fetch';
import { mayFeedText, mayShowText, structureRow, unitRows } from '@/lib/learn/catalogue/structure';

/**
 * Official explainers and primary-source menus.
 *
 * The fixtures in fixtures/structure/explainers/ are excerpts of the live
 * pages, fetched 2026-10-16: the six chapters of The Fed Explained and
 * Avalon's eighteenth-century menu. Each opens with a comment naming its
 * address.
 */

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/structure/explainers/${name}`, import.meta.url), 'utf8');

const CHAPTERS = [
  'who-we-are',
  'monetary-policy',
  'financial-stability',
  'supervision-regulation',
  'payment-systems',
  'consumers-communities',
];
const FED = 'https://www.federalreserve.gov/aboutthefed/fedexplained/';
const AVALON = 'https://avalon.law.yale.edu/subject_menus/18th.asp';

const fetched = vi.hoisted(() => ({ calls: [] as string[], missing: new Set<string>() }));

vi.mock('./fetch', () => ({
  fetchDocument: async (url: string): Promise<FetchResult> => {
    fetched.calls.push(url);
    const pages: Record<string, string> = { [AVALON]: 'avalon-18th.html' };
    for (const chapter of CHAPTERS) pages[`${FED}${chapter}.htm`] = `fed-${chapter}.html`;
    const file = pages[url];
    if (!file || fetched.missing.has(url)) return { ok: false, reason: 'not-found', detail: '404' };
    const text = readFileSync(new URL(`./fixtures/structure/explainers/${file}`, import.meta.url), 'utf8');
    return { ok: true, url, contentType: 'html', text, bytes: null, byteLength: text.length };
  },
}));

const explainers = await import('@/lib/learn/providers/explainers');

beforeEach(() => {
  fetched.calls.length = 0;
  fetched.missing.clear();
});

describe('the allowlist', () => {
  it('accepts the two starting pages and nothing else', () => {
    expect(explainers.explainerHostFor(explainers.FED_EXPLAINED_URL)?.host.providerSlug).toBe('federal-reserve');
    expect(explainers.explainerHostFor(AVALON)?.host.providerSlug).toBe('avalon');
    expect(explainers.explainerHostFor('http://avalon.law.yale.edu/subject_menus/18th.asp')).toBeNull();
    expect(explainers.explainerHostFor('https://example.com/subject_menus/18th.asp')).toBeNull();
    expect(explainers.explainerHostFor('https://www.federalreserve.gov/newsevents.htm')).toBeNull();
  });

  it('refuses a page off the list without fetching', async () => {
    const result = await explainers.pullExplainer('https://example.com/');
    expect(result).toMatchObject({ ok: false, reason: 'not-allowlisted' });
    expect(fetched.calls).toEqual([]);
  });
});

describe('The Fed Explained', () => {
  it('reads the six chapters, in order, from the nav', () => {
    const links = explainers.parseFedChapterNav(fixture('fed-who-we-are.html'), `${FED}who-we-are.htm`);
    expect(links.map((link) => link.url)).toEqual(CHAPTERS.map((chapter) => `${FED}${chapter}.htm`));
    expect(links[0]).toMatchObject({ heading: 'Who We Are', title: 'Who We Are' });
    expect(links[3].heading).toBe('Supervision & Regulation');
  });

  it('reads a chapter once, not the narrow-screen copy', () => {
    const chapter = explainers.parseFedChapter(fixture('fed-who-we-are.html'));
    expect(chapter.headings).toContain('The Three Key Entities');
    expect(chapter.text).toContain('The Federal Reserve is the U.S. central bank');
    expect(chapter.text).toContain('- 12 Federal Reserve Banks around the nation.');
    expect(chapter.text.split('The Three Key Entities')).toHaveLength(2);
    expect(chapter.text).not.toMatch(/<|&amp;|&nbsp;/);
  });

  it('stores as six ordered units with readable material', async () => {
    const result = await explainers.pullExplainer(explainers.FED_EXPLAINED_URL);
    if (!result.ok) throw new Error(result.detail);
    const doc = result.document;
    expect(fetched.calls).toHaveLength(6);
    expect(doc.units.map((unit) => unit.heading)).toEqual([
      'Who We Are',
      'Monetary Policy',
      'Financial Stability',
      'Supervision & Regulation',
      'Payment Systems',
      'Consumers & Communities',
    ]);
    expect(doc.units.every((unit) => unit.topics.length > 0)).toBe(true);
    expect(doc.licenceMode).toBe('show');
    expect(mayShowText(doc.licenceMode) && mayFeedText(doc.licenceMode)).toBe(true);
    expect(doc.rawText).toContain('# Monetary Policy');
    expect(structureRow(doc).content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(unitRows(doc.units)).toHaveLength(6);
  });

  it('reports a chapter that will not load rather than storing five', async () => {
    fetched.missing.add(`${FED}payment-systems.htm`);
    const result = await explainers.pullExplainer(explainers.FED_EXPLAINED_URL);
    expect(result).toMatchObject({ ok: false, reason: 'fetch-failed' });
  });
});

describe('the Avalon eighteenth-century menu', () => {
  it('reads each linked document in the menu order, once', () => {
    const menu = explainers.parseAvalonMenu(fixture('avalon-18th.html'), AVALON);
    expect(menu.title).toBe('18th Century Documents : 1700 - 1799');
    expect(menu.entries.length).toBeGreaterThan(150);
    expect(menu.entries[0].title).toBe('An Act for the Gradual Abolition of Slavery - Pennsylvania; March 1, 1780');
    expect(menu.entries[0].url).toBe('https://avalon.law.yale.edu/18th_century/pennst01.asp');
    const urls = menu.entries.map((entry) => entry.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('keeps entries with a missing closing tag, and marks collections', () => {
    const menu = explainers.parseAvalonMenu(fixture('avalon-18th.html'), AVALON);
    const madison = menu.entries.find((entry) => entry.url.endsWith('/madispap.asp'));
    expect(madison?.title).toBe('James Madison : Papers');
    const charles = menu.entries.find((entry) => entry.url.endsWith('/nj14.asp'));
    expect(charles?.title).toMatch(/^Charles II's Grant of New England/);
    expect(menu.entries.find((entry) => entry.url.endsWith('/fed.asp'))?.collection).toBe(true);
    expect(menu.entries.find((entry) => entry.url.endsWith('/declare.asp'))?.collection).toBe(false);
  });

  it('stores as ordered units under structure_only', async () => {
    const result = await explainers.pullExplainer(AVALON);
    if (!result.ok) throw new Error(result.detail);
    const doc = result.document;
    expect(doc.licenceMode).toBe('structure_only');
    expect(mayShowText(doc.licenceMode)).toBe(false);
    expect(doc.externalId).toBe('menu-18th');
    const declaration = doc.units.find((unit) => unit.heading.startsWith('Declaration of Independence'));
    expect(declaration?.readings[0].url).toBe('https://avalon.law.yale.edu/18th_century/declare.asp');
    expect(unitRows(doc.units)).toHaveLength(doc.units.length);
  });
});

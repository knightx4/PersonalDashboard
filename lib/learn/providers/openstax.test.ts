import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  bookFromCms,
  documentFromContents,
  parseContents,
  parseOpenstaxSlug,
  releaseFor,
  unitsFromTree,
} from '@/lib/learn/providers/openstax';
import { mayFeedText, mayShowText, structureRow, unitRows } from '@/lib/learn/catalogue/structure';

/**
 * Fixtures are the real answers fetched 2026-10-16 for Principles of
 * Macroeconomics 3e: the CMS book record, rex/release.json, and the archive
 * contents document with its rendered `content` field left out (it repeats
 * the tree). Nothing from the book's pages is in them.
 */
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/structure/openstax/${name}`, import.meta.url), 'utf8');
const CMS = fixture('cms-principles-macroeconomics-3e.json');
const RELEASE = fixture('release.json');
const CONTENTS = fixture('contents-principles-macroeconomics-3e.json');
const SLUG = 'principles-macroeconomics-3e';

describe('parseOpenstaxSlug', () => {
  it('reads a slug and the addresses a model writes it in', () => {
    expect(parseOpenstaxSlug(SLUG)).toBe(SLUG);
    expect(parseOpenstaxSlug(`https://openstax.org/books/${SLUG}/pages/1-introduction`)).toBe(SLUG);
    expect(parseOpenstaxSlug(`https://openstax.org/details/books/${SLUG}`)).toBe(SLUG);
  });
  it('refuses what is not a slug', () => {
    expect(parseOpenstaxSlug('Principles of Macroeconomics')).toBeNull();
    expect(parseOpenstaxSlug('../../etc')).toBeNull();
    expect(parseOpenstaxSlug('')).toBeNull();
  });
});

describe('the book record and the release', () => {
  const book = bookFromCms(CMS, SLUG)!;
  it('gives the book and its licence', () => {
    expect(book).toMatchObject({
      id: 'aff0c733-b223-4dfb-aad6-297bd361bdcf',
      title: 'Principles of Macroeconomics 3e',
    });
    expect(book.licenceUrl).toContain('creativecommons.org');
  });
  it('is null for a slug with no book', () => {
    expect(bookFromCms('{"meta":{"total_count":0},"items":[]}', 'nonesuch')).toBeNull();
    expect(bookFromCms(CMS, 'another-book')).toBeNull();
    expect(bookFromCms('not json', SLUG)).toBeNull();
  });
  it('finds the archive release and the book version', () => {
    expect(releaseFor(RELEASE, book.id)).toEqual({ archivePath: '/apps/archive/20260604.144757', version: 'd5cadb4' });
    expect(releaseFor(RELEASE, 'ffffffff-ffff-ffff-ffff-ffffffffffff')).toBeNull();
  });
  it('lets only the shapes OpenStax uses into an address', () => {
    const bad = JSON.stringify({ archiveUrl: '//evil.example/x', books: { [book.id]: { defaultVersion: 'd5cadb4' } } });
    expect(releaseFor(bad, book.id)).toBeNull();
    const badVersion = JSON.stringify({ archiveUrl: '/apps/archive/1', books: { [book.id]: { defaultVersion: '../x' } } });
    expect(releaseFor(badVersion, book.id)).toBeNull();
  });
});

describe('the chapters', () => {
  const units = unitsFromTree(parseContents(CONTENTS)!.contents);
  it('makes one unit per chapter, then the appendices, in order', () => {
    expect(units).toHaveLength(24);
    expect(units[0]).toMatchObject({ label: 'Chapter 1', heading: 'Welcome to Economics!' });
    expect(units[20]).toMatchObject({ label: 'Chapter 21', heading: 'Globalization and Protectionism' });
    expect(units.slice(21).map((u) => u.label)).toEqual(['Appendix A', 'Appendix B', 'Appendix C']);
  });
  it('lists the numbered sections as topics', () => {
    expect(units[0].topics).toEqual([
      '1.1 What Is Economics, and Why Is It Important?',
      '1.2 Microeconomics and Macroeconomics',
      '1.3 How Economists Use Theories and Models to Understand Economic Issues',
      '1.4 How To Organize Economies: An Overview of Economic Systems',
    ]);
    expect(units[5].topics[0]).toBe('6.1 Measuring the Size of the Economy: Gross Domestic Product');
  });
  it('leaves out front and back matter and chapter-end practice pages', () => {
    const all = units.flatMap((u) => [u.heading, ...u.topics]).join('\n');
    expect(all).not.toMatch(/^(?:Preface|Answer Key|References|Index|Key Terms|Review Questions|Self-Check Questions|Problems)$/m);
    expect(all).not.toContain('<');
  });
  it('looks through the parts of a book', () => {
    const chapter = { toc_type: 'chapter', title: '<span class="os-number">Chapter 1</span> <span class="os-text">One</span>' };
    expect(unitsFromTree([{ toc_type: 'unit', contents: [chapter] }])).toHaveLength(1);
  });
});

describe('the stored document', () => {
  const book = bookFromCms(CMS, SLUG)!;
  const result = documentFromContents(book, CONTENTS, 'https://openstax.org/apps/archive/x/contents/y.json');
  if (!result.ok) throw new Error(result.detail);
  const doc = result.document;

  it('cites the book and is marked never_feed', () => {
    expect(doc.providerSlug).toBe('openstax');
    expect(doc.externalId).toBe(SLUG);
    expect(doc.canonicalUrl).toBe(`https://openstax.org/details/books/${SLUG}`);
    expect(doc.licenceMode).toBe('never_feed');
  });
  it('is refused as material: nothing may be shown or given to a model', () => {
    expect(mayFeedText(doc.licenceMode)).toBe(false);
    expect(mayShowText(doc.licenceMode)).toBe(false);
  });
  it('keeps headings and nothing else as raw text', () => {
    const lines = doc.rawText.trim().split('\n');
    expect(lines.slice(0, 4)).toEqual(['Principles of Macroeconomics 3e', 'OpenStax', '', 'Contents']);
    expect(doc.rawText).toContain('Chapter 6 The Macroeconomic Perspective');
    expect(doc.rawText).toContain('  6.2 Adjusting Nominal Values to Real Values');
    // A heading is short; a paragraph of the book is not.
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThan(120);
  });
  it('becomes ordered unit rows and a document row the store accepts', () => {
    const rows = unitRows(doc.units);
    expect(rows.map((r) => r.ordinal)).toEqual(doc.units.map((_u, i) => i));
    expect(rows[5].text).toContain('Chapter 6: The Macroeconomic Perspective');
    const row = structureRow(doc);
    expect(row.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.licence_mode).toBe('never_feed');
  });
  it('refuses a contents document with no chapters', () => {
    expect(documentFromContents(book, '{"title":"x","tree":{"contents":[]}}', 'u')).toMatchObject({
      ok: false,
      reason: 'no-chapters',
    });
    expect(documentFromContents(book, 'nope', 'u')).toMatchObject({ ok: false, reason: 'error' });
  });
});

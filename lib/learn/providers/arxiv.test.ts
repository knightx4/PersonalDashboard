import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  documentFromPages,
  headingsFromHtml,
  licenceModeFor,
  parseAbstractPage,
  parseArxivId,
  unitsFromHeadings,
} from '@/lib/learn/providers/arxiv';
import { structureRow, unitRows } from '@/lib/learn/catalogue/structure';

/**
 * Fixtures are excerpts of the real pages fetched 2026-10-16: the abstract
 * page of arXiv 1906.07439v2 (Potts, Introduction to Quantum Thermodynamics,
 * lecture notes), the headings of its HTML rendering, and the headings of
 * 1907.01596v1 (Deffner and Campbell's book, which has chapters).
 */
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/structure/${name}`, import.meta.url), 'utf8');
const ABS = fixture('arxiv-1906.07439v2-abs.html');
const NOTES = fixture('arxiv-1906.07439v2-html.html');
const BOOK = fixture('arxiv-1907.01596v1-html.html');

describe('parseArxivId', () => {
  it('reads ids in every form a model writes them', () => {
    expect(parseArxivId('1906.07439')).toBe('1906.07439');
    expect(parseArxivId('arXiv:1906.07439v2')).toBe('1906.07439');
    expect(parseArxivId('https://arxiv.org/abs/1906.07439v2')).toBe('1906.07439');
    expect(parseArxivId('https://arxiv.org/pdf/1906.07439v2.pdf')).toBe('1906.07439');
    expect(parseArxivId('hep-th/9901001')).toBe('hep-th/9901001');
  });
  it('refuses what is not an id', () => {
    expect(parseArxivId('quantum thermodynamics')).toBeNull();
    expect(parseArxivId('https://example.com/abs/1906.07439')).toBeNull();
  });
});

describe('the abstract page', () => {
  const page = parseAbstractPage(ABS)!;
  it('gives the citation', () => {
    expect(page.title).toBe('Introduction to Quantum Thermodynamics (Lecture Notes)');
    expect(page.authors).toEqual(['Patrick P. Potts']);
    expect(page.date).toBe('2019/06/18');
    expect(page.pdfUrl).toBe('https://arxiv.org/pdf/1906.07439');
  });
  it('keeps the abstract without its label', () => {
    expect(page.abstract.startsWith('The theory of quantum thermodynamics')).toBe(true);
    expect(page.abstract).not.toContain('Abstract:');
  });
  it('is null for a page that is not a paper', () => {
    expect(parseAbstractPage('<html><body>Not found</body></html>')).toBeNull();
  });
  it('maps the licence link to a mode', () => {
    expect(page.licenceUrl).toBe('http://arxiv.org/licenses/nonexclusive-distrib/1.0/');
    expect(licenceModeFor(page.licenceUrl)).toBe('structure_only');
    expect(licenceModeFor('http://creativecommons.org/licenses/by/4.0/')).toBe('show');
    expect(licenceModeFor('http://creativecommons.org/publicdomain/zero/1.0/')).toBe('show');
    expect(licenceModeFor(null)).toBe('structure_only');
  });
});

describe('sections of lecture notes', () => {
  const units = unitsFromHeadings(headingsFromHtml(NOTES));
  it('makes one unit per numbered section, in order', () => {
    expect(units.map((u) => `${u.label} ${u.heading}`)).toEqual([
      '1 Introduction',
      '2 Basic concepts',
      '3 The laws of thermodynamics',
      '4 Markovian master equations',
      '5 Single-component systems',
      '6 Qubit entangler',
      '7 Conclusions & outlook',
    ]);
  });
  it('takes subsections as topics and drops exercises and hints', () => {
    expect(units[1].topics).toEqual(['The thermal state', 'Non-interacting particles', 'Bosons', 'Fermions']);
    expect(units[4].topics).toContain('Two baths - heat engine');
    expect(units.flatMap((u) => u.topics).some((t) => /exercise|hint|\(\dpt\)/i.test(t))).toBe(false);
  });
});

describe('chapters of a book', () => {
  const units = unitsFromHeadings(headingsFromHtml(BOOK));
  it('makes one unit per numbered chapter with its sections as topics', () => {
    expect(units[0]).toMatchObject({ label: 'Chapter 1', heading: 'The principles of modern thermodynamics' });
    expect(units).toHaveLength(3);
    expect(units[0].topics).toContain('Work, heat, and entropy production');
  });
  it('leaves out front matter, checklists and problems', () => {
    const all = units.flatMap((u) => [u.heading, ...u.topics]).join('\n');
    expect(all).not.toMatch(/Prologue|About the Authors|Checklist|Problems|Abstract/);
  });
});

describe('the stored document', () => {
  const result = documentFromPages('1906.07439', ABS, NOTES);
  it('cites the paper and keeps the abstract at the head of the raw text', () => {
    if (!result.ok) throw new Error(result.detail);
    const doc = result.document;
    expect(doc.canonicalUrl).toBe('https://arxiv.org/abs/1906.07439');
    expect(doc.externalId).toBe('1906.07439');
    expect(doc.courseCode).toBe('arXiv:1906.07439');
    expect(doc.author).toBe('Patrick P. Potts');
    expect(doc.rawText).toContain('The theory of quantum thermodynamics');
    expect(doc.rawText).toContain('4 Markovian master equations');
    expect(doc.licenceMode).toBe('structure_only');
  });
  it('becomes ordered unit rows and a document row the store accepts', () => {
    if (!result.ok) throw new Error(result.detail);
    const rows = unitRows(result.document.units);
    expect(rows.map((r) => r.ordinal)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(rows[3].text).toContain('Markovian master equations');
    expect(structureRow(result.document).content_hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('refuses a page that is not a paper and a rendering with no sections', () => {
    expect(documentFromPages('1906.07439', '<html></html>', NOTES)).toMatchObject({ ok: false, reason: 'not-found' });
    expect(documentFromPages('1906.07439', ABS, '<html></html>')).toMatchObject({ ok: false, reason: 'no-sections' });
  });
});

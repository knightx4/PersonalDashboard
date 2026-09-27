import { describe, expect, it } from 'vitest';
import {
  PASSAGE_MAX_CHARS,
  PASSAGE_MIN_CHARS,
  cutPassages,
  passageRowsForSections,
  passagesForSection,
} from './passages';

/** A sentence of about 80 characters, numbered so each one is distinct. */
const sentence = (n: number): string =>
  `Sentence ${n} says one thing about reciprocity and the norms that follow from it.`;
const paragraph = (from: number, count: number): string =>
  Array.from({ length: count }, (_, index) => sentence(from + index)).join(' ');

describe('cutting a section into passages', () => {
  it('keeps a section that fits as one passage', () => {
    const text = paragraph(0, 6);
    expect(cutPassages(text)).toEqual([text]);
  });

  it('splits a long single paragraph at sentence ends into passages of 300 to 800 characters', () => {
    // About 2,670 characters with no line break, like Reciprocity's
    // "Positive and negative reciprocity".
    const text = paragraph(0, 32);
    const passages = cutPassages(text);

    expect(passages.length).toBeGreaterThanOrEqual(3);
    for (const passage of passages) {
      expect(passage.length).toBeGreaterThanOrEqual(PASSAGE_MIN_CHARS);
      expect(passage.length).toBeLessThanOrEqual(PASSAGE_MAX_CHARS + PASSAGE_MIN_CHARS);
      expect(passage.endsWith('.')).toBe(true);
    }
    // Nothing is lost or reordered.
    expect(passages.join(' ').replace(/\n/g, ' ')).toBe(text);
  });

  it('breaks on paragraphs, and packs a short paragraph into its neighbour', () => {
    const text = [paragraph(0, 7), paragraph(10, 1), paragraph(20, 7)].join('\n');
    const passages = cutPassages(text);

    expect(passages.length).toBe(2);
    expect(passages[0]).toContain('Sentence 10 ');
    for (const passage of passages) expect(passage.length).toBeGreaterThanOrEqual(PASSAGE_MIN_CHARS);
  });

  it('joins a short tail to the passage before it', () => {
    const text = [paragraph(0, 9), paragraph(20, 2)].join('\n');
    const passages = cutPassages(text);

    expect(passages).toHaveLength(1);
    expect(passages[0]).toContain('Sentence 21 ');
  });

  it('splits a sentence with no break in it at a space', () => {
    const text = 'word '.repeat(400).trim();
    const passages = cutPassages(text);

    expect(passages.length).toBeGreaterThan(1);
    for (const passage of passages) {
      expect(passage.length).toBeLessThanOrEqual(PASSAGE_MAX_CHARS + PASSAGE_MIN_CHARS);
      expect(passage.startsWith('word')).toBe(true);
    }
  });

  it('cuts the same text the same way every time', () => {
    const text = [paragraph(0, 12), paragraph(30, 3), paragraph(40, 20)].join('\n\n');
    expect(cutPassages(text)).toEqual(cutPassages(text));
  });
});

describe('which sections get passages', () => {
  it('gives none to a stub or a link list', () => {
    expect(passagesForSection({ heading: 'Characteristics', text: 'a short stub of a section.' })).toEqual([]);
    expect(passagesForSection({ heading: 'See also', text: paragraph(0, 10) })).toEqual([]);
  });

  it('numbers each section\'s passages from 0 and names the section', () => {
    const rows = passageRowsForSections([
      { id: 'lead', heading: null, text: paragraph(0, 20) },
      { id: 'links', heading: 'External links', text: paragraph(50, 10) },
      { id: 'history', heading: 'History', text: paragraph(100, 5) },
    ]);

    const lead = rows.filter((row) => row.segment_id === 'lead');
    expect(lead.map((row) => row.ordinal)).toEqual(lead.map((_, index) => index));
    expect(rows.some((row) => row.segment_id === 'links')).toBe(false);
    expect(rows.filter((row) => row.segment_id === 'history')).toEqual([
      { segment_id: 'history', ordinal: 0, text: paragraph(100, 5) },
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { cutPassages, cutText, PASSAGE_TARGET } from './passages';

const paragraph = (word: string, sentences: number) =>
  Array.from({ length: sentences }, (_, i) => `${word} sentence number ${i} says something.`).join(' ');

describe('cutText', () => {
  it('keeps a short text as one passage', () => {
    expect(cutText('A short thought.')).toEqual(['A short thought.']);
    expect(cutText('   ')).toEqual([]);
  });

  it('cuts at headings before paragraphs, and packs small sections together', () => {
    const text = [
      '# One',
      paragraph('alpha', 20),
      '# Two',
      paragraph('beta', 20),
      '# Three',
      'Short.',
      '# Four',
      'Also short.',
    ].join('\n\n');
    const passages = cutText(text);
    expect(passages.length).toBeGreaterThan(1);
    for (const passage of passages) expect(passage.length).toBeLessThanOrEqual(PASSAGE_TARGET);
    expect(passages[0].startsWith('# One')).toBe(true);
    expect(passages.some((p) => p.startsWith('# Two'))).toBe(true);
    // The two short sections share one passage.
    expect(passages.some((p) => p.includes('# Three') && p.includes('# Four'))).toBe(true);
  });

  it('repeats a long section\'s heading on each of its passages', () => {
    const text = ['## Land value tax', ...Array.from({ length: 16 }, (_, i) => paragraph(`p${i}`, 8))].join('\n\n');
    const passages = cutText(text);
    expect(passages.length).toBeGreaterThan(2);
    for (const passage of passages) expect(passage.startsWith('## Land value tax')).toBe(true);
  });

  it('cuts one very long paragraph at sentences, and a sentence with none at the target', () => {
    const passages = cutText(paragraph('gamma', 200));
    for (const passage of passages) {
      expect(passage.length).toBeLessThanOrEqual(PASSAGE_TARGET);
      expect(passage.endsWith('.')).toBe(true);
    }
    const unbroken = cutText('x'.repeat(PASSAGE_TARGET * 2 + 10));
    expect(unbroken.map((p) => p.length)).toEqual([PASSAGE_TARGET, PASSAGE_TARGET, 10]);
  });

  it('does not treat a # inside a code fence as a heading', () => {
    const text = ['Intro.', '```', '# not a heading', '```', paragraph('delta', 60)].join('\n');
    expect(cutText(text).some((p) => p.startsWith('# not a heading'))).toBe(false);
  });

  it('loses no text', () => {
    const text = ['# A', paragraph('a', 40), '## B', paragraph('b', 5), paragraph('c', 70)].join('\n\n');
    const words = (s: string) => s.split(/\s+/).filter((w) => !w.startsWith('#') && w !== 'A' && w !== 'B');
    const out = cutText(text).flatMap(words);
    for (const word of new Set(words(text))) expect(out).toContain(word);
  });
});

describe('cutPassages', () => {
  it('puts the title on every passage and labels each by author', () => {
    const passages = cutPassages({ title: 'Buy a flat', mine: 'Two bedrooms.', dash: 'Found three listings.' });
    expect(passages).toEqual([
      { author: 'me', body: 'Buy a flat\n\nTwo bedrooms.' },
      { author: 'dash', body: 'Buy a flat\n\nFound three listings.' },
    ]);
  });

  it('makes the title the passage when there is no text', () => {
    expect(cutPassages({ title: 'Learn Spanish', mine: null, dash: null })).toEqual([
      { author: 'me', body: 'Learn Spanish' },
    ]);
    expect(cutPassages({ title: null, mine: null, dash: null })).toEqual([]);
  });

  it('is the same every time for the same row', () => {
    const row = { title: 'T', mine: paragraph('same', 90), dash: null };
    expect(cutPassages(row)).toEqual(cutPassages(row));
  });
});

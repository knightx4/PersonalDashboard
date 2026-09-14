import { describe, expect, it } from 'vitest';
import { planQuizQuestions } from '@/lib/learn/quiz/plan';

const para = (word: string, times: number) => `${word} `.repeat(times).trim();

describe('planQuizQuestions', () => {
  it('has nothing to ask when no source has any text', () => {
    expect(planQuizQuestions([{ id: 'a', title: 'A', text: '   ' }])).toEqual([]);
  });

  it('asks ten questions of one note', () => {
    const chunks = planQuizQuestions([{ id: 'a', title: 'A', text: para('rates', 400) }]);
    expect(chunks.reduce((total, chunk) => total + chunk.want, 0)).toBe(10);
    expect(chunks.every((chunk) => chunk.sourceId === 'a')).toBe(true);
  });

  it('gives every source at least one question, however short', () => {
    const chunks = planQuizQuestions([
      { id: 'long', title: 'Long', text: para('duration', 3000) },
      { id: 'short', title: 'Short', text: 'One line about convexity.' },
      { id: 'paste', title: 'Pasted', text: para('spread', 200) },
    ]);

    const per = new Map<string, number>();
    for (const chunk of chunks) per.set(chunk.sourceId, (per.get(chunk.sourceId) ?? 0) + chunk.want);

    expect(per.get('short')).toBeGreaterThanOrEqual(1);
    expect(per.get('paste')).toBeGreaterThanOrEqual(1);
    expect(per.get('long')).toBeGreaterThan(per.get('short')!);
    expect([...per.values()].reduce((a, b) => a + b, 0)).toBe(10);
  });

  it('raises the total rather than leaving a source with nothing', () => {
    const sources = Array.from({ length: 12 }, (_, index) => ({
      id: `s${index}`,
      title: `S${index}`,
      text: `Something about the ${index}th thing, at a little length.`,
    }));

    const chunks = planQuizQuestions(sources);
    const asked = new Set(chunks.map((chunk) => chunk.sourceId));

    expect(asked.size).toBe(12);
    expect(chunks.reduce((total, chunk) => total + chunk.want, 0)).toBe(12);
  });

  it('spreads a long note across its own headings rather than its first page', () => {
    const text = Array.from(
      { length: 8 },
      (_, index) => `## Part ${index}\n\n${para(`body${index}`, 120)}`,
    ).join('\n\n');

    const chunks = planQuizQuestions([{ id: 'a', title: 'A', text }]);

    expect(chunks).toHaveLength(8);
    expect(chunks.reduce((total, chunk) => total + chunk.want, 0)).toBe(10);
    // Taken from across the note: the last heading is asked about too.
    expect(chunks.at(-1)!.title).toContain('Part 7');
  });

  it('names the piece it came from when a note was split', () => {
    const text = `## Opening\n\n${para('one', 80)}\n\n## Closing\n\n${para('two', 80)}`;
    const chunks = planQuizQuestions([{ id: 'a', title: 'Bond maths', text }]);

    expect(chunks[0]!.title.startsWith('Bond maths — ')).toBe(true);
  });
});

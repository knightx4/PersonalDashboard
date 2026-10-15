import { describe, expect, it } from 'vitest';
import { buildSummary, quoteOf, summaryHeadline, QUOTE_CHARS, SUMMARY_ROWS, type SummaryAnswer } from './summary';

const answer = (over: Partial<SummaryAnswer>): SummaryAnswer => ({
  name: 'Burn multiple',
  quote: 'Net burn over new ARR.',
  held: true,
  why: null,
  conceptId: 'c1',
  answeredAt: '2026-10-15T10:00:00Z',
  ...over,
});

describe('quoteOf', () => {
  it('flattens whitespace and returns null for nothing', () => {
    expect(quoteOf('  a\n b  ')).toBe('a b');
    expect(quoteOf('   ')).toBeNull();
    expect(quoteOf(null)).toBeNull();
  });
  it('cuts a long quote at a word', () => {
    const cut = quoteOf('word '.repeat(80))!;
    expect(cut.length).toBeLessThanOrEqual(QUOTE_CHARS + 1);
    expect(cut.endsWith('…')).toBe(true);
  });
});

describe('buildSummary', () => {
  it('splits held from missed and keeps the last answer on an idea', () => {
    const summary = buildSummary(
      [
        answer({ answeredAt: '2026-10-15T10:00:00Z', held: true }),
        answer({ answeredAt: '2026-10-15T10:05:00Z', held: false, quote: null, why: 'No example.' }),
        answer({ conceptId: 'c2', name: 'CAC', quote: 'Cost to win a customer.', answeredAt: '2026-10-15T10:06:00Z' }),
      ],
      ['Payback period', 'Payback period'],
    );
    expect(summary.answers).toBe(3);
    expect(summary.shown).toEqual([{ name: 'CAC', quote: 'Cost to win a customer.' }]);
    expect(summary.missed).toEqual([{ name: 'Burn multiple', quote: null, why: 'No example.' }]);
    expect(summary.fringe).toEqual(['Payback period']);
  });

  it('limits rows and counts the rest', () => {
    const many = Array.from({ length: SUMMARY_ROWS + 2 }, (_, i) =>
      answer({ conceptId: `c${i}`, name: `Idea ${i}`, answeredAt: `2026-10-15T10:0${i}:00Z` }),
    );
    const summary = buildSummary(many, []);
    expect(summary.shown).toHaveLength(SUMMARY_ROWS);
    expect(summary.more.shown).toBe(2);
  });
});

describe('summaryHeadline', () => {
  it('reads for all held, none held and a mix', () => {
    expect(summaryHeadline(buildSummary([answer({})], []))).toBe('1 answer, and every idea shown');
    expect(summaryHeadline(buildSummary([answer({ held: false })], []))).toBe('1 answer, none shown yet');
    expect(
      summaryHeadline(buildSummary([answer({}), answer({ conceptId: 'c2', held: false })], [])),
    ).toBe('2 answers: 1 shown, 1 missed');
  });
});

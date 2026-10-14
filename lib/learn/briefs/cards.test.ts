import { describe, expect, it } from 'vitest';
import {
  MIN_SOURCE_CHARS,
  briefCardToWrite,
  orderQuickRead,
  planBriefCards,
  sourceText,
  type BriefSource,
} from './cards';

/**
 * Which of a brief's sources become Learn now cards (plan #2023.6), what the
 * writer is given for one, and the order of the brief's quick read.
 */

const long = (word: string) => `${word} `.repeat(Math.ceil(MIN_SOURCE_CHARS / (word.length + 1)) + 1).trim();

function source(overrides: Partial<BriefSource> = {}): BriefSource {
  return {
    readingId: 'r1',
    userId: 'u1',
    briefId: 'b1',
    question: 'How do SOX controls apply to AI?',
    angle: 'For interviews in audit.',
    title: 'AI and internal control',
    givenText: null,
    summary: long('summary'),
    ...overrides,
  };
}

describe('the text a source is written from', () => {
  it('reads the given text before the summary, and neither when both are thin', () => {
    expect(sourceText({ givenText: long('given'), summary: long('summary') })).toMatch(/^given/);
    expect(sourceText({ givenText: 'short', summary: long('summary') })).toMatch(/^summary/);
    expect(sourceText({ givenText: null, summary: 'Too short to hold an idea.' })).toBeNull();
  });
});

describe('planning the cards', () => {
  it('writes a source with no card, retries one left picked, and leaves the rest', () => {
    const sources = [
      source({ readingId: 'new' }),
      source({ readingId: 'picked' }),
      source({ readingId: 'ready' }),
      source({ readingId: 'dropped' }),
      source({ readingId: 'thin', summary: 'thin' }),
    ];
    const jobs = planBriefCards(sources, [
      { id: 'c-picked', readingId: 'picked', status: 'picked' },
      { id: 'c-ready', readingId: 'ready', status: 'ready' },
      { id: 'c-dropped', readingId: 'dropped', status: 'dropped' },
    ]);
    expect(jobs.map((job) => [job.source.readingId, job.cardId])).toEqual([
      ['new', null],
      ['picked', 'c-picked'],
    ]);
  });

  it('hands the writer one idea from the source, for the brief question', () => {
    expect(briefCardToWrite(source(), 'c1')).toMatchObject({
      id: 'c1',
      reason: 'researched',
      article: 'AI and internal control',
      segmentId: null,
      maxIdeas: 1,
      research: {
        question: 'How do SOX controls apply to AI?',
        angle: 'For interviews in audit.',
        source: 'AI and internal control',
      },
    });
    expect(briefCardToWrite(source({ summary: null }), 'c1')).toBeNull();
  });
});

describe('the quick read order', () => {
  it('follows the reading list, with a card off the list last', () => {
    const cards = [
      { id: 'a', readingId: 'r3' },
      { id: 'b', readingId: null },
      { id: 'c', readingId: 'r1' },
      { id: 'd', readingId: 'gone' },
      { id: 'e', readingId: 'r2' },
    ];
    expect(orderQuickRead(cards, ['r1', 'r2', 'r3']).map((card) => card.id)).toEqual(['c', 'e', 'a', 'b', 'd']);
  });
});

import { describe, expect, it } from 'vitest';
import {
  MIN_SOURCE_CHARS,
  SECTION_IDEA_BASE,
  briefCardToWrite,
  briefSectionSources,
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

describe('a brief under a goal (plan #2184.1)', () => {
  const aim = { id: 'a1', name: 'SOX and internal control' };
  const brief = {
    id: 'b1',
    userId: 'u1',
    question: 'How do SOX controls apply to AI?',
    angle: '',
    aim,
    subQuestions: [
      { id: '1', text: 'When does an AI tool become part of ICFR?' },
      { id: '2', text: 'What must management document?' },
      { id: '3', text: 'Who is liable?' },
    ],
    sections: [
      {
        sub_question_id: '1',
        position: 'As soon as its output feeds a figure or a review that management relies on in the close.',
        citations: [
          { reading_id: 'gone', quote: 'Not on the list.' },
          { reading_id: 'r2', quote: 'The tool is then part of the process and in scope.' },
        ],
      },
      { sub_question_id: '2', position: 'The model, its inputs and the review of its output.', citations: [] },
    ],
  };
  const titles = new Map([['r2', 'COSO on AI']]);

  it('makes a card of each answered sub-question that quotes a page, on that page, for the goal', () => {
    const sections = briefSectionSources(brief, titles);
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ readingId: 'r2', ideaIndex: SECTION_IDEA_BASE, aim, title: 'COSO on AI' });
    expect(sourceText(sections[0]!)).toContain('“The tool is then part of the process and in scope.” (COSO on AI)');
  });

  it('writes the section card from the answer, for the sub-question, naming the goal', () => {
    const [section] = briefSectionSources(brief, titles);
    expect(briefCardToWrite(section!, 'c9')).toMatchObject({
      reason: 'researched',
      aimName: 'SOX and internal control',
      research: { question: 'When does an AI tool become part of ICFR?' },
    });
    expect(briefCardToWrite(source({ aim }), 'c1')?.aimName).toBe('SOX and internal control');
  });

  it("keeps a page's card and a section card on the same page apart", () => {
    const [section] = briefSectionSources(brief, titles);
    const jobs = planBriefCards([source({ readingId: 'r2' }), section!], [{ id: 'c-page', readingId: 'r2', status: 'ready' }]);
    expect(jobs.map((job) => job.source.ideaIndex)).toEqual([SECTION_IDEA_BASE]);
    expect(
      planBriefCards([section!], [{ id: 'c-s', readingId: 'r2', status: 'ready', ideaIndex: SECTION_IDEA_BASE }]),
    ).toEqual([]);
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

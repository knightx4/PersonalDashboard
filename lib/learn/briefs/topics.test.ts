import { describe, expect, it } from 'vitest';
import { readDrafting, sourceText } from '@/lib/learn/levels/draft-sources';
import { asEmerging, briefDraftSources, goalPerformances, readDraftedFromBrief } from './topics';

/**
 * A research brief as the sources a topic is drafted from, and the draft's
 * rows settled as emerging (plan #2184.1).
 */

const brief = {
  question: 'How do SOX controls apply to AI?',
  sections: [
    {
      sub_question_id: '1',
      position: 'When its output feeds a figure management relies on.',
      citations: [
        { reading_id: 'r2', quote: 'The tool is part of the process.' },
        { reading_id: 'r1', quote: 'Controls over AI are tested like any automated control.' },
      ],
    },
    {
      sub_question_id: '2',
      position: 'Document the model and its review.',
      citations: [
        { reading_id: 'r2', quote: 'Management documents the review.' },
        { reading_id: 'r2', quote: 'The tool is part of the process.' },
      ],
    },
  ],
};

const pages = [
  { readingId: 'r1', title: 'SEC staff statement', kind: 'Regulator', summary: null },
  { readingId: 'r2', title: 'COSO on AI', kind: null, summary: null },
  { readingId: 'r3', title: 'Not quoted', kind: 'Press', summary: 'A page nothing quoted from at all here.' },
];

describe("a brief's pages as sources", () => {
  it('gives each quoted page its quotes as lines, most quoted first, naming the brief', () => {
    const given = briefDraftSources(brief, pages, ['Explain an AI control to a controller']);
    expect(given.performances).toEqual(['Explain an AI control to a controller']);
    expect(given.sources.map((s) => [s.id, s.items])).toEqual([
      ['S1', ['The tool is part of the process.', 'Management documents the review.']],
      ['S2', ['Controls over AI are tested like any automated control.']],
    ]);
    expect(given.sources[1]!.label).toBe('From your research on “How do SOX controls apply to AI?”: SEC staff statement (Regulator)');
    // A row citing a line reads as the brief, the page and the words.
    expect(sourceText(['S2.1'], given)).toBe(
      'From your research on “How do SOX controls apply to AI?”: SEC staff statement (Regulator): Controls over AI are tested like any automated control.',
    );
  });

  it("falls back to the pages' summaries when nothing was quoted", () => {
    const given = briefDraftSources(
      { question: 'Q', sections: [] },
      [{ readingId: 'r1', title: 'A page', kind: null, summary: 'The first sentence is long enough. The second one is too, really.' }],
      [],
    );
    expect(given.sources).toEqual([
      { id: 'S1', label: 'From your research on “Q”: A page', items: ['The first sentence is long enough.', 'The second one is too, really.'] },
    ]);
  });
});

describe('settling a draft from a brief', () => {
  it('marks every cited row emerging, leaves uncited rows for the person, and cites the sources on the topic', () => {
    const settled = asEmerging({
      topicCites: [],
      canonicality: 'canonical' as const,
      cells: [
        { level: 1, checks: [], cites: ['S1.2'], canonicality: 'canonical' as const },
        { level: 2, checks: [], cites: [], canonicality: null },
      ],
      links: [{ fromLevel: 1, topicId: 't', topicName: 'Return', level: 2, why: '', cites: ['S2'], canonicality: 'practitioner' as const }],
    });
    expect(settled.topicCites).toEqual(['S1', 'S2']);
    expect(settled.canonicality).toBe('emerging');
    expect(settled.cells.map((c) => c.canonicality)).toEqual(['emerging', null]);
    expect(settled.links[0]!.canonicality).toBe('emerging');
  });

  it('keeps the brief on the drafting record and reads it back', () => {
    const record = {
      sources: [],
      performances: [],
      coverage: { share: null, sources: [], uncovered: [] },
      structure: { acyclic: true, offPath: [], served: [], unserved: [] },
      overlap: 0.7,
      overlapMissing: null,
      checklist: [],
      brief: { id: 'b1', question: 'Q', aimId: 'a1', aimName: 'SOX' },
    };
    expect(readDrafting(record)?.brief).toEqual({ id: 'b1', question: 'Q', aimId: 'a1', aimName: 'SOX' });
    expect(readDrafting({ ...record, brief: undefined })?.brief).toBeUndefined();
    expect(readDraftedFromBrief({ id: 'b1' })).toBeNull();
  });

  it("takes the goal's performances from its newest topic drafted with some", () => {
    expect(
      goalPerformances([
        { createdAt: '2026-10-01', performances: ['Old'] },
        { createdAt: '2026-10-09', performances: [] },
        { createdAt: '2026-10-05', performances: ['Newer'] },
      ]),
    ).toEqual(['Newer']);
    expect(goalPerformances([])).toEqual([]);
  });
});

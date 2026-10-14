import { describe, expect, it } from 'vitest';
import {
  briefStage,
  foundKind,
  sectionSources,
  sourceLine,
  summaryLine,
  toBriefOnPage,
  type BriefPageRow,
  type BriefSource,
} from './view';

const row: BriefPageRow = {
  id: 'b1',
  track_id: 't1',
  question: 'How do SOX controls apply to AI?',
  angle: null,
  depth: 'deep',
  sub_questions: [{ id: 'a', text: 'When is it in scope?' }, { id: 'b', text: 'What is tested?' }],
  status: 'ready',
  stage: null,
  error: null,
  sections: [
    {
      sub_question_id: 'a',
      position: 'Once a figure depends on it.',
      citations: [
        { reading_id: 'r1', quote: 'within its assessment' },
        { reading_id: 'r1', quote: 'again from the same' },
        { reading_id: 'r2', quote: 'principles apply' },
      ],
    },
  ],
  short_answer: null,
  short_answer_by: 'dash',
  watch_on: false,
  watched_at: null,
  quiet_checks: 0,
  archived_at: null,
  created_at: '2026-10-13T09:00:00Z',
  updated_at: '2026-10-13T09:00:00Z',
  tracks: [{ title: 'SOX and AI' }],
};

describe('reading a brief row for its page', () => {
  it("reads the row with model.ts's shapes and adds the track title", () => {
    const brief = toBriefOnPage(row);
    expect(brief.trackTitle).toBe('SOX and AI');
    expect(brief.subQuestions).toHaveLength(2);
    expect(brief.sections[0]?.citations).toHaveLength(3);
    expect(brief.sections[0]?.sub_question_id).toBe('a');
    expect(brief.angle).toBe('');
    expect(brief.watchOn).toBe(false);
    expect(brief.stage).toBeNull();
  });

  it('has no track title when the brief has no reading list yet', () => {
    expect(toBriefOnPage({ ...row, track_id: null, tracks: null }).trackTitle).toBeNull();
    expect(toBriefOnPage({ ...row, tracks: { title: 'One' } }).trackTitle).toBe('One');
  });

  it('reads only the found kinds the column allows', () => {
    expect(foundKind('professional_body')).toBe('professional_body');
    expect(foundKind('blog')).toBeNull();
    expect(foundKind(null)).toBeNull();
  });
});

describe('the stage a researching brief is on', () => {
  const none = { subQuestions: [], sections: [], stage: null };
  const asked = { ...none, subQuestions: [{ id: 'a', text: 'Q' }, { id: 'b', text: 'Q2' }] };

  it('is read from what the run has written when it has not said', () => {
    expect(briefStage(none, 0).stage).toBe('framing');
    expect(briefStage(asked, 0).stage).toBe('searching');
    expect(briefStage(asked, 3).stage).toBe('writing');
    expect(
      briefStage({ ...asked, sections: [{ sub_question_id: 'a', position: 'P', citations: [] }] }, 3).detail,
    ).toBe('1 of 2 questions answered so far.');
  });

  it('follows the stage the run recorded, with its label', () => {
    expect(briefStage({ ...asked, stage: 'framing' }, 0).label).toBe('Breaking the question down');
    expect(briefStage({ ...asked, stage: 'searching' }, 4).label).toBe('Searching and reading sources');
    expect(briefStage({ ...asked, stage: 'writing' }, 4).label).toBe('Writing the answers');
  });

  it('says framing while there are no sub-questions, whatever the stage', () => {
    expect(briefStage({ ...none, stage: 'searching' }, 0).stage).toBe('framing');
  });
});

describe('sources', () => {
  const source = (id: string, extra: Partial<BriefSource> = {}): BriefSource => ({
    readingId: id,
    title: `Source ${id}`,
    kind: null,
    year: null,
    foundAt: null,
    url: null,
    ...extra,
  });

  it('lists each cited reading once, in the order first quoted', () => {
    const brief = toBriefOnPage(row);
    const found = sectionSources(brief.sections[0]!, { r1: source('r1'), r2: source('r2') });
    expect(found.map((s) => s.readingId)).toEqual(['r1', 'r2']);
  });

  it('names the kind and the date for the quote popover', () => {
    expect(sourceLine(source('r', { kind: 'professional_body', year: 2024 }))).toBe('Professional body · 2024');
    expect(sourceLine(source('r', { kind: 'press', foundAt: '2026-10-13T09:00:00Z' }))).toBe('Press · found 13 Oct 2026');
    expect(sourceLine(source('r'))).toBe('Kind and date not known');
  });
});

describe("Now's line under a brief", () => {
  it('says what state it is in', () => {
    const base = { id: 'b', question: 'Q', subQuestions: 4, updatedAt: '' };
    expect(summaryLine({ ...base, status: 'ready' })).toBe('4 questions answered with sources');
    expect(summaryLine({ ...base, status: 'researching' })).toBe('Dash is researching this now.');
    expect(summaryLine({ ...base, status: 'failed' })).toBe('The research stopped. Open it to try again.');
  });
});

import { describe, expect, it } from 'vitest';
import {
  briefStage,
  parseSections,
  parseSubQuestions,
  sectionSources,
  sourceLine,
  summaryLine,
  toBrief,
  type BriefRow,
  type BriefSource,
} from './view';

const row: BriefRow = {
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
  archived_at: null,
  created_at: '2026-10-13T09:00:00Z',
  updated_at: '2026-10-13T09:00:00Z',
  tracks: [{ title: 'SOX and AI' }],
};

describe('reading a brief row', () => {
  it('keeps the shapes it knows and the track title', () => {
    const brief = toBrief(row);
    expect(brief.trackTitle).toBe('SOX and AI');
    expect(brief.subQuestions).toHaveLength(2);
    expect(brief.sections[0]?.citations).toHaveLength(3);
    expect(brief.angle).toBe('');
    expect(brief.watchOn).toBe(false);
    expect(brief.stage).toBeNull();
  });

  it('leaves out entries that are not the expected shape', () => {
    expect(parseSubQuestions([{ id: 1, text: 'Numbered' }, { text: '' }, 'Plain', 7])).toEqual([
      { id: '1', text: 'Numbered' },
      { id: '3', text: 'Plain' },
    ]);
    expect(parseSections([{ sub_question_id: 'a' }, null, { sub_question_id: 'b', position: 'Yes', citations: [{}] }])).toEqual([
      { subQuestionId: 'b', position: 'Yes', citations: [] },
    ]);
    expect(parseSections('not an array')).toEqual([]);
  });

  it('falls back on unknown status, depth and stage', () => {
    const brief = toBrief({ ...row, status: 'odd', depth: 'odd', stage: 'odd' });
    expect(brief.status).toBe('researching');
    expect(brief.depth).toBe('standard');
    expect(brief.stage).toBeNull();
  });
});

describe('the stage a researching brief is on', () => {
  const none = { subQuestions: [], sections: [], stage: null };
  const asked = { ...none, subQuestions: [{ id: 'a', text: 'Q' }, { id: 'b', text: 'Q2' }] };

  it('is read from what the run has written when it has not said', () => {
    expect(briefStage(none, 0).label).toBe('Framing the questions');
    expect(briefStage(asked, 0).label).toBe('Searching for sources');
    expect(briefStage(asked, 3).label).toBe('Reading the sources');
    expect(
      briefStage({ ...asked, sections: [{ subQuestionId: 'a', position: 'P', citations: [] }] }, 3).detail,
    ).toBe('1 of 2 questions answered so far.');
  });

  it('follows the stage the run recorded', () => {
    expect(briefStage({ ...asked, stage: 'framing' }, 0).label).toBe('Framing the questions');
    expect(briefStage({ ...asked, stage: 'searching' }, 4).label).toBe('Searching for sources');
    expect(briefStage({ ...asked, stage: 'writing' }, 4).label).toBe('Writing the answers');
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
    const brief = toBrief(row);
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

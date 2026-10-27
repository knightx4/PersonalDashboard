import { describe, expect, it } from 'vitest';
import {
  cleanQuestion,
  decisionColumns,
  decisionError,
  decisionOf,
  optionLabel,
  initials,
  optionsOf,
  questionOf,
  sortAdvisors,
  type QuestionInput,
} from '@/lib/you/board-questions';

const roster = ['hiring_manager', 'mentor', 'skeptic', 'cfo', 'dreamer', 'buffett'];
const input = (over: Partial<QuestionInput> = {}): QuestionInput => ({
  question: 'Take the contract?',
  options: ['', ''],
  context: '',
  lean: '',
  advisors: [],
  ...over,
});

describe('cleanQuestion', () => {
  it('takes a question with no options, for the chair to write', () => {
    const r = cleanQuestion(input({ question: '  Take the\n contract? ' }), roster);
    expect(r).toEqual({
      ok: true,
      value: { question: 'Take the contract?', options: [], context: null, lean: null, advisors: [] },
    });
  });

  it('letters the options in order, drops blank lines and keeps a lean letter upper case', () => {
    const r = cleanQuestion(input({ options: ['Take it', '', 'Turn it down'], lean: 'b', advisors: ['cfo', 'cfo'] }), roster);
    expect(r).toMatchObject({
      ok: true,
      value: {
        options: [
          { letter: 'A', text: 'Take it' },
          { letter: 'B', text: 'Turn it down' },
        ],
        lean: 'B',
        advisors: ['cfo'],
      },
    });
  });

  it('refuses a blank question, one option, five options, a lean on no option and an advisor not on the board', () => {
    expect(cleanQuestion(input({ question: ' ' }), roster).ok).toBe(false);
    expect(cleanQuestion(input({ options: ['Only one', ''] }), roster)).toMatchObject({
      ok: false,
      error: expect.stringContaining('at least two'),
    });
    expect(cleanQuestion(input({ options: ['a', 'b', 'c', 'd', 'e'] }), roster).ok).toBe(false);
    expect(cleanQuestion(input({ options: ['a', 'b'], lean: 'C' }), roster)).toMatchObject({
      ok: false,
      error: 'There is no option C to lean towards.',
    });
    expect(cleanQuestion(input({ advisors: ['dalio'] }), roster).ok).toBe(false);
  });

  it('keeps a lean in words', () => {
    expect(cleanQuestion(input({ lean: 'towards taking it' }), roster)).toMatchObject({
      ok: true,
      value: { lean: 'towards taking it' },
    });
  });
});

describe('reading rows', () => {
  it('drops options of the wrong shape and a row with no status', () => {
    expect(optionsOf([{ letter: 'a', text: 'x' }, { letter: 'AB', text: 'y' }, 'z', { letter: 'B' }])).toEqual([
      { letter: 'A', text: 'x' },
    ]);
    expect(questionOf({ id: 'q', question: 'Q?', status: 'nope' })).toBeNull();
    expect(questionOf({ id: 'q', question: 'Q?', status: 'suggested', source: 'board' })).toMatchObject({
      source: 'board',
      options: [],
      advisors: [],
      meetingId: null,
    });
  });
});

describe('advisors', () => {
  it('shows a guest by initials', () => {
    expect(initials('Warren Buffett')).toBe('WB');
    expect(initials('Leonardo da Vinci')).toBe('LV');
    expect(initials('Benjamin Franklin')).toBe('BF');
  });

  it('puts the seats first in their order, then guests by name', () => {
    const sorted = sortAdvisors([
      { key: 'jobs', name: 'Steve Jobs', kind: 'guest', focus: null },
      { key: 'cfo', name: 'CFO', kind: 'seat', focus: null },
      { key: 'buffett', name: 'Warren Buffett', kind: 'guest', focus: null },
      { key: 'mentor', name: 'Mentor', kind: 'seat', focus: null },
    ]);
    expect(sorted.map((a) => a.key)).toEqual(['mentor', 'cfo', 'jobs', 'buffett']);
  });
});

describe('the person’s decision (plan #2561.6)', () => {
  const options = [
    { letter: 'A', text: 'Take it' },
    { letter: 'B', text: 'Leave it' },
  ];

  it('an option decides the question and stamps the time', () => {
    expect(decisionColumns({ kind: 'option', letter: 'B' }, '  because  ', '2026-11-01T10:00:00Z')).toEqual({
      status: 'decided',
      decided_option: 'B',
      decision_note: 'because',
      decided_at: '2026-11-01T10:00:00Z',
    });
  });

  it('putting off and turning down clear the option and the time, so decided iff decided_at holds', () => {
    expect(decisionColumns({ kind: 'defer' }, null, 'x')).toEqual({
      status: 'deferred',
      decided_option: null,
      decision_note: null,
      decided_at: null,
    });
    expect(decisionColumns({ kind: 'reject' }, '', 'x').status).toBe('dismissed');
  });

  it('refuses an option the question lacks and a note that is too long', () => {
    expect(decisionError({ kind: 'option', letter: 'C' }, options, null)).toMatch(/not one of/);
    expect(decisionError({ kind: 'option', letter: 'A' }, options, 'x'.repeat(2001))).toMatch(/at most 2,000/);
    expect(decisionError({ kind: 'defer' }, [], null)).toBeNull();
    expect(decisionError({ kind: 'option', letter: 'B' }, options, 'fine')).toBeNull();
  });

  it('reads a decided row with the board’s recommendation, and drops one without a choice', () => {
    const row = {
      id: 'q1',
      question: 'Take it?',
      options,
      verdict: { recommended: 'A' },
      decided_option: 'B',
      decision_note: 'later',
      decided_at: '2026-11-01T10:00:00Z',
      meeting_id: 'm1',
    };
    expect(decisionOf(row)).toMatchObject({ recommended: 'A', chosen: 'B', note: 'later', meetingId: 'm1' });
    expect(decisionOf({ ...row, verdict: null })?.recommended).toBeNull();
    expect(decisionOf({ ...row, decided_option: null })).toBeNull();
  });

  it('names an option by letter and text', () => {
    expect(optionLabel(options, 'B')).toBe('B, Leave it');
    expect(optionLabel(options, 'D')).toBe('D');
    expect(optionLabel(options, null)).toBeNull();
  });
});

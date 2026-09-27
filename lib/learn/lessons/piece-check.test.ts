import { describe, expect, it } from 'vitest';
import { EARLIER_NAMED, passedState, pieceCheckPrompt, pieceLines, toPieceCheck, type PieceForCheck } from './piece-check';

const piece: PieceForCheck = {
  trackName: 'SaaS metrics',
  unitTitle: 'Retention',
  unitOutcome: 'Read a cohort grid and say what it shows.',
  pieceTitle: 'Why churn compounds',
  ideas: [
    { name: 'Monthly churn', claim: 'Churn is the share of customers lost each month.' },
    { name: 'Compounding loss', claim: 'A steady monthly churn loses a share of what is left, so losses compound.' },
  ],
};

describe('pieceLines', () => {
  it('names the track, the unit and its outcome, the piece and each idea with its claim', () => {
    expect(pieceLines(piece)).toEqual([
      'Track: SaaS metrics',
      'Unit: Retention',
      "The unit's outcome: Read a cohort grid and say what it shows.",
      'This piece of it: Why churn compounds',
      '',
      'The ideas the piece teaches:',
      '- Monthly churn: Churn is the share of customers lost each month.',
      '- Compounding loss: A steady monthly churn loses a share of what is left, so losses compound.',
    ]);
  });

  it('leaves the outcome out when the unit has none', () => {
    expect(pieceLines({ ...piece, unitOutcome: '  ' })).not.toContain("The unit's outcome: ");
    expect(pieceLines({ ...piece, unitOutcome: null }).some((line) => line.startsWith("The unit's outcome"))).toBe(false);
  });
});

describe('pieceCheckPrompt', () => {
  it('asks for the tool and names no earlier questions on a first try', () => {
    const prompt = pieceCheckPrompt(piece, [], 'report_question');
    expect(prompt).not.toContain('Already asked');
    expect(prompt.endsWith('Call report_question.')).toBe(true);
  });

  it('lists the questions already asked, so a fresh one is written', () => {
    const prompt = pieceCheckPrompt(piece, ['Why does a 5% churn lose more than 5% in a year?'], 'report_question');
    expect(prompt).toContain('Already asked on this piece, so ask something else:');
    expect(prompt).toContain('- Why does a 5% churn lose more than 5% in a year?');
  });

  it(`names at most ${EARLIER_NAMED} earlier questions`, () => {
    const asked = Array.from({ length: EARLIER_NAMED + 3 }, (_, index) => `Question ${index + 1}?`);
    const prompt = pieceCheckPrompt(piece, asked, 'report_question');
    expect(prompt).toContain(`Question ${EARLIER_NAMED}?`);
    expect(prompt).not.toContain(`Question ${EARLIER_NAMED + 1}?`);
  });
});

describe('passedState', () => {
  it('keeps sharp and makes everything else known', () => {
    expect(passedState('sharp')).toBe('sharp');
    expect(passedState('known')).toBe('known');
    expect(passedState('shaky')).toBe('known');
    expect(passedState('unknown')).toBe('known');
    expect(passedState('misconception')).toBe('known');
    expect(passedState(null)).toBe('known');
  });
});

describe('toPieceCheck', () => {
  const row = {
    id: 'c1',
    question: 'Why does churn compound?',
    expected: 'Each month loses a share of what is left.',
    response: null,
    correct: null,
    marked_why: null,
  };

  it('keeps the expected answer off the page until the question is answered', () => {
    expect(toPieceCheck(row).expected).toBeNull();
  });

  it('shows the expected answer and the mark once answered', () => {
    const answered = toPieceCheck({ ...row, response: 'It is a share.', correct: false, marked_why: 'It missed what is left.' });
    expect(answered).toMatchObject({
      expected: 'Each month loses a share of what is left.',
      correct: false,
      why: 'It missed what is left.',
    });
  });
});

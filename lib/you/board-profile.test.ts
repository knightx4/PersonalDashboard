import { describe, expect, it } from 'vitest';
import { advisorDecisions, percent, recordLine } from './board-profile';

const options = [
  { letter: 'A', text: 'Take the offer' },
  { letter: 'B', text: 'Keep looking' },
];

describe('advisorDecisions', () => {
  it('keeps the last forecast on each question, with what happened and the score', () => {
    const decisions = advisorDecisions(
      'cfo',
      [
        { question_id: 'q1', probabilities: { A: 0.4, B: 0.5 }, scores: null },
        { question_id: 'q1', probabilities: { A: 0.7, B: 0.3 }, scores: null },
        { question_id: 'q1', probabilities: null, scores: null },
      ],
      [
        {
          id: 'q1',
          meeting_id: 'm1',
          question: 'Take the offer?',
          options,
          status: 'decided',
          decided_option: 'A',
          decided_at: '2026-09-01T00:00:00Z',
          created_at: '2026-08-20T00:00:00Z',
          reviews: [
            {
              at: 30,
              account: 'It went well.',
              outcome: 'well',
              answered_at: '2026-10-01T00:00:00Z',
              scores: [
                { advisor: 'cfo', probability: 0.7, brier: 0.09 },
                { advisor: 'mentor', probability: 0.2, brier: 0.64 },
              ],
            },
          ],
        },
      ],
    );
    expect(decisions).toEqual([
      expect.objectContaining({
        questionId: 'q1',
        meetingId: 'm1',
        forecast: { A: 0.7, B: 0.3 },
        pick: 'A',
        chosen: 'A',
        outcome: 'well',
        brier: 0.09,
      }),
    ]);
  });

  it('reads an older decision from its scores, with no probability and nothing scored', () => {
    const [d] = advisorDecisions(
      'cfo',
      [{ question_id: 'q2', probabilities: null, scores: { A: 4, B: 8 } }],
      [{ id: 'q2', question: 'Move?', options, status: 'open', created_at: '2026-07-01T00:00:00Z', reviews: [] }],
    );
    expect(d).toMatchObject({ forecast: null, pick: 'B', chosen: null, outcome: null, brier: null });
  });

  it('leaves out questions they did not speak on, and puts the newest first', () => {
    const rows = [
      { id: 'old', question: 'Old', options, created_at: '2026-01-01T00:00:00Z' },
      { id: 'new', question: 'New', options, created_at: '2026-06-01T00:00:00Z' },
      { id: 'other', question: 'Other', options, created_at: '2026-07-01T00:00:00Z' },
    ];
    const turns = [
      { question_id: 'old', probabilities: { A: 0.5 }, scores: null },
      { question_id: 'new', probabilities: { A: 0.5 }, scores: null },
    ];
    expect(advisorDecisions('cfo', turns, rows).map((d) => d.questionId)).toEqual(['new', 'old']);
  });
});

describe('recordLine', () => {
  it('says how many were scored and the mean, or that none is yet', () => {
    expect(recordLine(null)).toBe('No forecasts scored yet');
    expect(recordLine({ advisor: 'cfo', name: 'CFO', scored: 7, brier: 0.1234, topics: [] })).toBe(
      '7 scored · mean 0.12',
    );
  });
});

describe('percent', () => {
  it('rounds a probability to a whole percent', () => {
    expect(percent(0.625)).toBe('63%');
  });
});

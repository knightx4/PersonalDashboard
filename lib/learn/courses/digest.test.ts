import { describe, expect, it } from 'vitest';
import { checkDigest, checkLectures, clock, digestTotals, linkMoments, momentsIn, secondsOf, type Lecture } from './digest';

const LECTURES: Lecture[] = [
  { code: 'L07', title: 'Value At Risk', videoId: '92WaNz9mPeY', durationSeconds: 4875, speaker: 'Ken Abbott' },
  { code: 'L11', title: 'Time Series', videoId: '_IFUfFuyQlU', durationSeconds: 4800, speaker: null },
];

function digest(overrides: Record<string, unknown> = {}) {
  return {
    madeFor: 'A CPA who knows regression.',
    intro: 'Two lectures, read in full. See [[L07 21:49]].',
    lessons: [
      {
        key: 'A',
        title: 'Measuring risk',
        point: 'VaR is the loss you will not exceed on 99% of days.',
        ideas: [
          {
            name: 'Value at Risk',
            treatment: 'clip',
            body: 'Daily sigma of 1.8% times 2.33 gives 4.2% [[L07 21:49-29:39]].',
            clips: [{ code: 'L07', start: '21:49', end: '29:39', listenFor: 'The backtest.' }],
          },
          { name: 'Fat tails', treatment: 'card', body: 'A t(10) fit puts a 6 sigma day at 1 in 10,000 [[L11 19:32]].', clips: [] },
        ],
        check: { question: 'Work the VaR on $10M.', answer: '$420K.' },
      },
    ],
    dependencies: { intro: '', tracks: [{ title: 'Risk', steps: ['Covariance', 'VaR'] }] },
    tensions: { intro: '', rows: [{ tension: 'How fat are the tails?', oneSide: 'Normal [[L07 24:55]]', otherSide: 't [[L11 19:32]]', lands: 'The backtest concedes it.' }] },
    ratings: {
      intro: '',
      rows: [
        { code: 'L07', rating: 'watch', watch: '[[L07 21:49-29:39]]', why: 'The practitioner view.' },
        { code: 'L11', rating: 'skim', watch: '', why: 'Known material.' },
      ],
    },
    ideas: Array.from({ length: 5 }, (_, index) => ({ title: `Idea ${index + 1}`, body: 'With its example.' })),
    path: { intro: '', budgetMinutes: 30, clips: [{ code: 'L07', start: '21:49', end: '29:39', get: 'The VaR calculation.' }] },
    errors: { intro: '', rows: [{ where: '[[L07 24:55]]', said: '3 sigma once per 10,000.', correction: 'About 1 in 740.' }] },
    ...overrides,
  };
}

describe('moments', () => {
  it('reads clock times as seconds and back', () => {
    expect(secondsOf('21:49')).toBe(1309);
    expect(secondsOf('1:21:15')).toBe(4875);
    expect(secondsOf('soon')).toBeNull();
    expect(clock(1309)).toBe('21:49');
    expect(clock(4875)).toBe('1:21:15');
  });

  it('finds tokens with and without an end', () => {
    expect(momentsIn('See [[L07 21:49]] and [[L11 19:32-22:36]].')).toEqual([
      { code: 'L07', start: 1309, end: null, raw: '[[L07 21:49]]' },
      { code: 'L11', start: 1172, end: 1356, raw: '[[L11 19:32-22:36]]' },
    ]);
  });

  it('builds each link from the stored video id', () => {
    expect(linkMoments('See [[L07 21:49]].', LECTURES)).toBe('See [L07 21:49](https://www.youtube.com/watch?v=92WaNz9mPeY&t=1309).');
    expect(linkMoments('[[L07 21:49-29:39]]', LECTURES)).toContain('[L07 21:49 to 29:39]');
    expect(linkMoments('See [[X01 1:00]].', LECTURES)).toBe('See X01 1:00.');
  });
});

describe('checkDigest', () => {
  it('keeps a digest that checks, and works out the path minutes itself', () => {
    const checked = checkDigest(digest(), LECTURES);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.digest.path.clips[0]).toMatchObject({ start: 1309, end: 1779, minutes: 8 });
    expect(digestTotals(checked.digest, LECTURES)).toMatchObject({ pathMinutes: 8, watch: 1, skim: 1 });
  });

  const failing: [string, Record<string, unknown>, RegExp][] = [
    ['a time past the end of the lecture', { intro: 'See [[L07 1:30:00]].' }, /past the end of L07/],
    ['a lecture the course lacks', { intro: 'See [[L99 1:00]].' }, /L99, which the course does not have/],
    ['a typed link', { intro: 'See https://www.youtube.com/watch?v=92WaNz9mPeY.' }, /typed YouTube link/],
    ['an em dash', { madeFor: 'A CPA — and an MBA.' }, /em dash/],
    ['too few big ideas', { ideas: [] }, /big ideas/],
    ['a path over its budget', { path: { budgetMinutes: 5, clips: [{ code: 'L07', start: '21:49', end: '29:39', get: 'x' }] } }, /against a budget of 5/],
  ];
  it.each(failing)('refuses %s', (_name, overrides, problem) => {
    const checked = checkDigest(digest(overrides), LECTURES);
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.problems.join('\n')).toMatch(problem);
  });

  it('refuses a lecture left without a rating (D4)', () => {
    const base = digest();
    const checked = checkDigest({ ...base, ratings: { rows: [base.ratings.rows[0]] } }, LECTURES);
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.problems.join('\n')).toMatch(/L11 has no rating/);
  });

  it('refuses a clip idea with no clip', () => {
    const base = digest();
    const lesson = { ...base.lessons[0], ideas: [{ name: 'VaR', treatment: 'clip', body: 'x', clips: [] }] };
    const checked = checkDigest({ ...base, lessons: [lesson] }, LECTURES);
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.problems.join('\n')).toMatch(/clip with no clip/);
  });
});

describe('checkLectures', () => {
  it('reads lengths given as clock times', () => {
    const checked = checkLectures([{ code: 'L07', title: 'VaR', videoId: '92WaNz9mPeY', durationSeconds: '1:21:15' }]);
    expect(checked).toEqual({ ok: true, lectures: [{ code: 'L07', title: 'VaR', videoId: '92WaNz9mPeY', durationSeconds: 4875, speaker: null }] });
  });

  it('refuses a repeated code or a missing video id', () => {
    const checked = checkLectures([
      { code: 'L07', title: 'a', videoId: '92WaNz9mPeY', durationSeconds: 60 },
      { code: 'L07', title: 'b', videoId: 'nope', durationSeconds: 60 },
    ]);
    expect(checked.ok).toBe(false);
  });
});

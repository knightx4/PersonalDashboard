import { describe, expect, it } from 'vitest';
import { debateFrom } from '@/lib/you/board-debate';
import {
  agreementOn,
  forecastsOf,
  headline,
  isForecast,
  leadingOption,
  quotable,
  stackDots,
  steelmanOf,
  theExchange,
  rangeText,
  advisorDecisionHref,
  plainCondition,
  waitingOf,
  withoutCitations,
} from '@/lib/you/board-spread';

const Q = 'q1';
const advisors = [
  { id: 'a1', key: 'mentor', name: 'Mentor', kind: 'seat' },
  { id: 'a2', key: 'skeptic', name: 'Skeptic', kind: 'seat' },
  { id: 'a3', key: 'cfo', name: 'CFO', kind: 'seat' },
];
const question = (over: Record<string, unknown> = {}) => ({
  id: Q,
  question: 'Take the contract?',
  options: [
    { letter: 'A', text: 'Take it' },
    { letter: 'B', text: 'Say no' },
  ],
  status: 'discussing',
  door: 'one_way',
  ...over,
});
let n = 0;
const turn = (over: Record<string, unknown>) => ({
  id: `t${n}`,
  question_id: Q,
  round: 1,
  kind: 'opening',
  text: 'Take it. The runway is short.',
  position: n++,
  ...over,
});

const turns = [
  turn({
    advisor_id: 'a1',
    probabilities: { A: 0.4, B: 0.5 },
    budget: { A: 40, B: 60 },
    blind: true,
    ranges: { A: { low: 1, high: 3, unit: 'offers' } },
  }),
  turn({
    advisor_id: 'a2',
    probabilities: { A: 0.2, B: 0.6 },
    budget: { A: 20, B: 80 },
    blind: true,
    text: 'Say no [c41d0a2e]. The hours say so.',
  }),
  turn({
    advisor_id: 'a3',
    probabilities: { A: 0.8, B: 0.2 },
    budget: { A: 90, B: 10 },
    blind: true,
  }),
  turn({
    advisor_id: 'a2',
    round: 2,
    kind: 'reply',
    addressed_to: 'a3',
    text: 'CFO, you count the money only.',
    probabilities: { A: 0.3, B: 0.5 },
  }),
  turn({
    advisor_id: 'a3',
    round: 2,
    kind: 'reply',
    addressed_to: 'a2',
    text: 'Skeptic, money is the constraint.',
  }),
  turn({ advisor_id: 'a1', round: 2, kind: 'reply', text: 'On your lean: no move.' }),
];

describe('a decision worked with probabilities', () => {
  const debate = debateFrom([question()], turns, advisors);
  const q = debate.questions[0];
  const forecasts = forecastsOf(q, debate.advisors);

  it('reads the new columns and tells it from an older decision', () => {
    expect(isForecast(q)).toBe(true);
    const old = debateFrom(
      [question({ door: null })],
      [turn({ advisor_id: 'a1', scores: { A: 7 } })],
      advisors,
    );
    expect(isForecast(old.questions[0])).toBe(false);
  });

  it('takes each advisor’s latest numbers, keeping round 1 for the move', () => {
    const skeptic = forecasts.find((f) => f.advisor.key === 'skeptic')!;
    expect(skeptic.probabilities).toEqual({ A: 0.3, B: 0.5 });
    expect(skeptic.first).toEqual({ A: 0.2, B: 0.6 });
    expect(skeptic.line).toBe('Say no.');
  });

  it('leads with the highest mean and says how far apart they are', () => {
    expect(leadingOption(q, forecasts)).toBe('A');
    expect(agreementOn(forecasts, 'A')).toMatchObject({ low: 0.3, high: 0.8, kind: 'split' });
    expect(headline(q, forecasts, false)).toBe(
      'The advisors give A the best chance, 50%, but range from 30% to 80%.',
    );
  });

  it('prefers the verdict’s weighted numbers', () => {
    const decided = debateFrom(
      [question({ verdict: { recommended: 'B', probability: { A: 0.4, B: 0.45 } } })],
      turns,
      advisors,
    ).questions[0];
    expect(leadingOption(decided, forecasts)).toBe('B');
    expect(headline(decided, forecasts, false)).toBe(
      'The advisors give B the best chance, 45%, but range from 20% to 50%.',
    );
  });

  it('separates the exchange from the lean replies', () => {
    expect(theExchange(q).map((t) => t.id)).toEqual(['t3', 't4']);
    expect(steelmanOf(q)).toBeNull();
  });

  it('says when nobody has answered yet', () => {
    const empty = debateFrom([question()], [], advisors).questions[0];
    expect(headline(empty, [], true)).toBe('No advisor has answered yet.');
  });
});

describe('quotable', () => {
  it('keeps the first sentence and takes out links and citations', () => {
    expect(quotable('See [the note](/vault/n/x.md) first. Then more.')).toBe('See the note first.');
  });
  it('cuts a long sentence at a word', () => {
    const long = `${'word '.repeat(60)}end.`;
    const got = quotable(long)!;
    expect(got.length).toBeLessThanOrEqual(160);
    expect(got.endsWith('…')).toBe(true);
  });
});

it('gives a unanimous decision its steelman and no exchange', () => {
  const debate = debateFrom(
    [question()],
    [
      turn({ advisor_id: 'a1', probabilities: { A: 0.7, B: 0.3 }, blind: true }),
      turn({
        advisor_id: 'a2',
        round: 2,
        kind: 'reply',
        addressed_to: 'a1',
        text: 'Arguing for B, which nobody backed: the wall.',
      }),
      turn({
        advisor_id: 'a1',
        round: 2,
        kind: 'reply',
        addressed_to: 'a2',
        text: 'Skeptic, it does not hold.',
      }),
    ],
    advisors,
  );
  const q = debate.questions[0];
  expect(theExchange(q)).toEqual([]);
  expect(steelmanOf(q)?.answer?.text).toBe('Skeptic, it does not hold.');
});

it('names who is still answering, and cleans what the page quotes', () => {
  const debate = debateFrom(
    [question({ option_order: { mentor: ['A', 'B'], skeptic: ['B', 'A'], cfo: ['A', 'B'] } })],
    [turn({ advisor_id: 'a1', probabilities: { A: 0.7, B: 0.3 }, blind: true })],
    advisors,
  );
  const q = debate.questions[0];
  const forecasts = forecastsOf(q, debate.advisors);
  expect(waitingOf(q, debate.advisors, forecasts).map((a) => a.key)).toEqual(['skeptic', 'cfo']);
  expect(headline(q, forecasts, true, q.seated.length)).toBe(
    '1 of 3 advisors have answered so far, and A leads at 70%.',
  );
  expect(withoutCitations('forty-two on side projects [c41d0a2e]. And [a note](/x).')).toBe(
    'forty-two on side projects. And [a note](/x).',
  );
  expect(plainCondition('Fewer than five sent by 1 Dec, in job_search.applications.')).toBe(
    'Fewer than five sent by 1 Dec.',
  );
});

describe('stackDots', () => {
  it('stacks dots that would overlap', () => {
    const got = stackDots([{ p: 0.5 }, { p: 0.52 }, { p: 0.9 }]);
    expect(got.map((d) => d.row)).toEqual([0, 1, 0]);
  });
});

it('writes a range and the profile link', () => {
  expect(rangeText({ low: 5200, high: 6800, unit: 'a month' })).toBe('5,200 to 6,800 a month');
  expect(advisorDecisionHref('cfo', 'q1')).toBe(
    '/you/council/advisors/cfo?tab=record#decision-q1',
  );
});

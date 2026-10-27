import { describe, expect, it } from 'vitest';
import {
  believabilityFrom,
  believabilityOf,
  brier,
  latestForecasts,
  sameBelievability,
  scoreForecasts,
  trackRecords,
  weightOf,
  type Forecast,
} from './board-scoring';

describe('scoring a forecast (plan #2581.10)', () => {
  it('takes each advisor latest turn with probabilities', () => {
    const forecasts = latestForecasts([
      { advisor: 'cfo', probabilities: { A: 0.2, B: 0.8 } },
      { advisor: 'skeptic', probabilities: { A: 0.5, B: 0.5 } },
      { advisor: 'cfo', probabilities: null },
      { advisor: 'cfo', probabilities: { A: 0.6, B: 0.4 } },
      { advisor: 'mentor', probabilities: { A: 'high' } },
    ]);
    expect(forecasts).toEqual([
      { advisor: 'cfo', probabilities: { A: 0.6, B: 0.4 } },
      { advisor: 'skeptic', probabilities: { A: 0.5, B: 0.5 } },
    ]);
  });

  it('Brier-scores the chosen option: met is 1, not met is 0, partly scores nothing', () => {
    const forecasts: Forecast[] = [
      { advisor: 'cfo', probabilities: { A: 0.8, B: 0.3 } },
      { advisor: 'skeptic', probabilities: { B: 0.9 } },
    ];
    expect(scoreForecasts(forecasts, 'A', 'well')).toEqual([{ advisor: 'cfo', probability: 0.8, brier: 0.04 }]);
    expect(scoreForecasts(forecasts, 'A', 'badly')).toEqual([{ advisor: 'cfo', probability: 0.8, brier: 0.64 }]);
    expect(scoreForecasts(forecasts, 'A', 'mixed')).toEqual([]);
    expect(scoreForecasts(forecasts, null, 'well')).toEqual([]);
    expect(brier(0.5, 1)).toBe(0.25);
  });
});

describe('believability', () => {
  it('averages each advisor by topic, leaving out a decision with no topic', () => {
    const b = believabilityFrom(
      [
        { topic: 'work', scores: [{ advisor: 'cfo', probability: 0.8, brier: 0.04 }] },
        { topic: 'work', scores: [{ advisor: 'cfo', probability: 0.4, brier: 0.36 }] },
        { topic: 'money', scores: [{ advisor: 'cfo', probability: 0.5, brier: 0.25 }] },
        { topic: null, scores: [{ advisor: 'skeptic', probability: 0.1, brier: 0.81 }] },
      ],
      'now',
    );
    expect(b.get('cfo')).toEqual({
      work: { scored: 2, brier: 0.2, updated_at: 'now' },
      money: { scored: 1, brier: 0.25, updated_at: 'now' },
    });
    expect(b.has('skeptic')).toBe(false);
  });

  it('reads the stored shape and compares without the time', () => {
    const stored = believabilityOf({
      work: { scored: 2, brier: 0.2, updated_at: 'then' },
      junk: 1,
      money: { scored: 0, brier: 0 },
    });
    expect(stored).toEqual({ work: { scored: 2, brier: 0.2, updated_at: 'then' } });
    expect(sameBelievability(stored, { work: { scored: 2, brier: 0.2, updated_at: 'now' } })).toBe(true);
    expect(sameBelievability(stored, {})).toBe(false);
    expect(believabilityOf(null)).toEqual({});
  });

  it('weighs 1 until five are scored, then by the mean, held to 0.25..2', () => {
    expect(weightOf(undefined)).toBe(1);
    expect(weightOf({ scored: 4, brier: 0, updated_at: '' })).toBe(1);
    expect(weightOf({ scored: 5, brier: 0.25, updated_at: '' })).toBe(1);
    expect(weightOf({ scored: 5, brier: 0, updated_at: '' })).toBe(2);
    expect(weightOf({ scored: 5, brier: 0.6, updated_at: '' })).toBe(0.25);
  });

  it('ranks the leaderboard closest first and skips advisors never scored', () => {
    const records = trackRecords([
      {
        key: 'cfo',
        name: 'CFO',
        believability: {
          work: { scored: 6, brier: 0.1, updated_at: '' },
          money: { scored: 2, brier: 0.3, updated_at: '' },
        },
      },
      { key: 'skeptic', name: 'Skeptic', believability: { work: { scored: 1, brier: 0.04, updated_at: '' } } },
      { key: 'dreamer', name: 'Dreamer', believability: {} },
    ]);
    expect(records.map((r) => r.advisor)).toEqual(['skeptic', 'cfo']);
    expect(records[1]).toMatchObject({ scored: 8, brier: 0.15 });
    expect(records[1].topics[0]).toMatchObject({ topic: 'work', weight: 1.6 });
  });
});

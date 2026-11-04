import { describe, expect, it } from 'vitest';
import type { BigFiveResult, TypedResult } from './model';
import {
  profileFrom,
  profileKey,
  profilePrompt,
  profileQueries,
  profileState,
  recordLines,
} from './profile';

const COMMON = {
  createdAt: '2026-10-07T18:00:00Z',
  note: null,
  read: null,
  readFailedAt: null,
};

const BIG: BigFiveResult = {
  ...COMMON,
  id: 'b1',
  kind: 'big_five',
  testName: 'Big Five',
  takenAt: '2026-10-12',
  answers: [],
  scores: { extraversion: 29, agreeableness: 37, conscientiousness: 33, emotional_stability: 39, intellect: 39 },
};

const DISC: TypedResult = {
  ...COMMON,
  id: 'd1',
  kind: 'other',
  testName: 'DISC',
  typedValue: 'Support',
  takenAt: '2026-10-29',
  typeScores: null,
  themes: [
    { name: 'Support', domain: null, summary: 'Helpful.', score: 96, insights: [], blindSpots: [], actions: [] },
    { name: 'Drive', domain: null, summary: null, score: 56, insights: [], blindSpots: [], actions: [] },
  ],
};

const MBTI: TypedResult = {
  ...COMMON,
  id: 'm1',
  kind: 'mbti',
  testName: 'Myers-Briggs',
  typedValue: 'INTJ',
  takenAt: '2025-10-12',
  typeScores: null,
  themes: null,
};

describe('profileKey', () => {
  it('is the same whatever the order and whatever Dash read', () => {
    const read = { ...MBTI, read: { points: [], model: 'm', at: '2026-10-20T00:00:00Z' } };
    expect(profileKey([BIG, DISC, MBTI])).toBe(profileKey([MBTI, BIG, { ...DISC }]));
    expect(profileKey([BIG, DISC, MBTI])).toBe(profileKey([BIG, DISC, read]));
  });

  it('changes when a result is added, changed or deleted', () => {
    const key = profileKey([BIG, DISC, MBTI]);
    expect(profileKey([BIG, DISC])).not.toBe(key);
    expect(profileKey([BIG, DISC, { ...MBTI, typedValue: 'INTP' }])).not.toBe(key);
    expect(profileKey([{ ...BIG, scores: { ...BIG.scores, intellect: 40 } }, DISC, MBTI])).not.toBe(key);
    const themes = DISC.themes!.map((t) => (t.name === 'Drive' ? { ...t, score: 60 } : t));
    expect(profileKey([BIG, { ...DISC, themes }, MBTI])).not.toBe(key);
  });
});

describe('profileState', () => {
  it('offers the first analysis once there are two results to compare', () => {
    expect(profileState([BIG], null)).toBe('none');
    expect(profileState([BIG, MBTI], null)).toBe('first');
  });

  it('offers it again only when the results changed since', () => {
    const profile = { resultsKey: profileKey([BIG, MBTI]) };
    expect(profileState([MBTI, BIG], profile)).toBe('current');
    expect(profileState([BIG, MBTI, DISC], profile)).toBe('changed');
    expect(profileState([BIG], profile)).toBe('changed');
  });
});

describe('the prompt', () => {
  it('gives every result, the record as worked out, and leaves out what was not', () => {
    const lines = recordLines({
      signals: { applications: { submitted: 717, past_screen: 33 }, dropped_asks: { total: 'x' } },
      signalsDay: '2026-10-29',
      readings: { queued: 15, read: 3 },
    });
    expect(lines).toEqual([
      'As of 2026-10-29:',
      '- Job applications: sent in all 717, got past the first screen 33',
      '- Learn readings: saved and not started 15, in progress 0, finished 3',
    ]);
    const text = profilePrompt([MBTI, BIG, DISC], { signals: null, signalsDay: null, readings: null }, []);
    expect(text.indexOf('DISC: Support')).toBeLessThan(text.indexOf('Big Five'));
    expect(text).toContain('1. Support, 96 of 100: Helpful.');
    expect(text).toContain('- nothing worked out yet');
  });

  it('looks for notes near every Big Five trait and each other test once', () => {
    const queries = profileQueries([BIG, DISC]);
    expect(queries).toHaveLength(5 + 1 + 1);
    expect(new Set(queries).size).toBe(queries.length);
  });
});

describe('profileFrom', () => {
  const notes = [{ note: { id: 'n1', path: 'Me/About me.md', title: 'About me', body: 'x' } }];

  it('ties a tension to the note it names and drops items with no text', () => {
    const profile = profileFrom(
      {
        summary: ' You think first. ',
        agreements: [{ text: 'Curious', tests: ['Big Five', 'CliftonStrengths'] }, { tests: [] }],
        tensions: [
          { text: 'INTJ against Support', tests: ['Myers-Briggs', 'DISC'], verdict: 'Your notes side with Support.', note: 'N1' },
          { text: 'Another', tests: [], verdict: 'Nothing settles it.', note: 'N9' },
        ],
        watch: [{ text: 'Research over doing', evidence: '15 saved, 3 finished' }, { text: 'No number' }],
      },
      notes,
    );
    expect(profile).toEqual({
      summary: 'You think first.',
      agreements: [{ text: 'Curious', tests: ['Big Five', 'CliftonStrengths'] }],
      tensions: [
        {
          text: 'INTJ against Support',
          tests: ['Myers-Briggs', 'DISC'],
          verdict: 'Your notes side with Support.',
          note: { id: 'n1', title: 'About me', path: 'Me/About me.md' },
        },
        { text: 'Another', tests: [], verdict: 'Nothing settles it.', note: null },
      ],
      watch: [{ text: 'Research over doing', evidence: '15 saved, 3 finished' }],
    });
  });

  it('is null with no summary', () => {
    expect(profileFrom({ agreements: [] }, notes)).toBeNull();
    expect(profileFrom('nope', notes)).toBeNull();
  });
});

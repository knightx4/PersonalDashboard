import { describe, expect, it } from 'vitest';
import {
  fieldAnswered,
  surveyCandidates,
  tallySurvey,
  type SurveyPool,
  type SurveyTheme,
} from './pick';

/**
 * Choosing the theme a survey question is about: never a track, spread across
 * fields, untested fields first.
 */

const FIELDS = new Map([
  ['econ', 'Economics'],
  ['phil', 'Philosophy'],
  ['bio', 'Biology'],
]);

function theme(id: string, fieldId: string, strength: number, extra: Partial<SurveyTheme> = {}) {
  return { id, name: id, strength, fieldId, hasNotes: true, ...extra };
}

function pool(overrides: Partial<SurveyPool> = {}): SurveyPool {
  return {
    themes: [
      theme('money', 'econ', 9),
      theme('inflation', 'econ', 8),
      theme('stoicism', 'phil', 3),
      theme('ethics', 'phil', 2),
      theme('cells', 'bio', 1),
    ],
    fieldNames: FIELDS,
    trackThemeIds: new Set(),
    trackNames: [],
    trackTestedFields: new Set(),
    counts: { byField: new Map(), byTheme: new Map() },
    ...overrides,
  };
}

describe('surveyCandidates', () => {
  it('takes one theme from each field before a second from any', () => {
    const picked = surveyCandidates(pool(), 4);
    expect(picked.map((c) => c.themeId)).toEqual(['money', 'stoicism', 'cells', 'inflation']);
    expect(picked[0]).toEqual({
      themeId: 'money',
      themeName: 'money',
      fieldId: 'econ',
      fieldName: 'Economics',
    });
  });

  it('leaves out a theme that is a track, by id or by name', () => {
    const picked = surveyCandidates(
      pool({ trackThemeIds: new Set(['money']), trackNames: ['  Stoicism '] }),
      10,
    );
    const ids = picked.map((c) => c.themeId);
    expect(ids).not.toContain('money');
    expect(ids).not.toContain('stoicism');
    expect(ids[0]).toBe('inflation');
  });

  it('leaves out a theme with no notes, one in no known field, and one skipped', () => {
    const picked = surveyCandidates(
      pool({
        themes: [
          theme('empty', 'econ', 9, { hasNotes: false }),
          theme('stray', 'nowhere', 9),
          theme('money', 'econ', 5),
          theme('stoicism', 'phil', 3),
        ],
      }),
      10,
      new Set(['stoicism']),
    );
    expect(picked.map((c) => c.themeId)).toEqual(['money']);
  });

  it('puts a field with nothing answered before one tested by a track or the survey', () => {
    const byTrack = surveyCandidates(pool({ trackTestedFields: new Set(['econ']) }), 3);
    expect(byTrack.map((c) => c.fieldId)).toEqual(['phil', 'bio', 'econ']);

    const bySurvey = surveyCandidates(
      pool({
        counts: {
          byField: new Map([['econ', { asked: 1, answered: 1 }]]),
          byTheme: new Map([['money', { asked: 1, answered: 1 }]]),
        },
      }),
      3,
    );
    expect(bySurvey.map((c) => c.fieldId)).toEqual(['phil', 'bio', 'econ']);
  });

  it('moves on to another field as each question is written', () => {
    const current = pool();
    const fields: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const [next] = surveyCandidates(current, 1);
      fields.push(next.fieldId);
      // Writing a question counts it as asked, answered or not.
      for (const [map, id] of [
        [current.counts.byField, next.fieldId],
        [current.counts.byTheme, next.themeId],
      ] as const) {
        const count = map.get(id) ?? { asked: 0, answered: 0 };
        map.set(id, { ...count, asked: count.asked + 1 });
      }
    }
    expect(fields).toEqual(['econ', 'phil', 'bio', 'econ', 'phil', 'bio']);
    expect(new Set(fields.slice(0, 3)).size).toBe(3);
  });

  it('asks about the least asked theme in a field first', () => {
    const picked = surveyCandidates(
      pool({
        counts: {
          byField: new Map([['econ', { asked: 1, answered: 0 }]]),
          byTheme: new Map([['money', { asked: 1, answered: 0 }]]),
        },
      }),
      10,
    );
    expect(picked.find((c) => c.fieldId === 'econ')!.themeId).toBe('inflation');
  });

  it('returns nothing when every theme is a track', () => {
    const all = pool();
    expect(
      surveyCandidates({ ...all, trackThemeIds: new Set(all.themes.map((t) => t.id)) }),
    ).toEqual([]);
  });
});

describe('tallySurvey', () => {
  it('counts written and answered questions per theme and per field', () => {
    const counts = tallySurvey({
      subjects: [
        { id: 's-money', themeId: 'money' },
        { id: 's-stoicism', themeId: 'stoicism' },
        { id: 's-loose', themeId: 'unplaced' },
      ],
      placements: new Map([
        ['money', 'econ'],
        ['stoicism', 'phil'],
      ]),
      concepts: [
        { id: 'c1', subjectId: 's-money' },
        { id: 'c2', subjectId: 's-money' },
        { id: 'c3', subjectId: 's-stoicism' },
        { id: 'c4', subjectId: 's-loose' },
        { id: 'track-idea', subjectId: 'a-track' },
      ],
      probes: [
        { conceptId: 'c1', answered: true },
        { conceptId: 'c2', answered: false },
        { conceptId: 'c3', answered: false },
        { conceptId: 'c4', answered: true },
        { conceptId: 'track-idea', answered: true },
      ],
    });
    expect(counts.byField).toEqual(
      new Map([
        ['econ', { asked: 2, answered: 1 }],
        ['phil', { asked: 1, answered: 0 }],
      ]),
    );
    expect(counts.byTheme.get('unplaced')).toEqual({ asked: 1, answered: 1 });
    expect(counts.byTheme.has('track-idea')).toBe(false);
    expect(fieldAnswered('econ', { trackTestedFields: new Set(), counts })).toBe(true);
    expect(fieldAnswered('phil', { trackTestedFields: new Set(), counts })).toBe(false);
  });
});

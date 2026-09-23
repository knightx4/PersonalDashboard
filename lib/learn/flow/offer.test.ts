import { describe, expect, it } from 'vitest';
import {
  LOW_WATER,
  runningLow,
  strongestUntestedField,
  trackToOffer,
  type OfferRecord,
  type ThemeCandidate,
} from './offer';

/**
 * Which theme from the vault map the flow offers as a new track (plan #778).
 * The strongest one you have no track for, less anything you declined.
 */

const NOW = new Date('2026-09-22T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function theme(id: string, name: string, strength: number, notes = 5): ThemeCandidate {
  return { id, name, about: `about ${name}`, strength, notes };
}

function pressed(
  themeId: string,
  themeName: string,
  outcome: OfferRecord['outcome'],
  daysAgo = 0,
): OfferRecord {
  return {
    themeId,
    themeName,
    outcome,
    happenedAt: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
  };
}

const THEMES = [
  theme('t-urban', 'Urban design', 60),
  theme('t-agency', 'Personal agency', 51),
  theme('t-systems', 'Emergent systems', 36),
];

const offer = (input: {
  trackNames?: string[];
  record?: OfferRecord[];
  themes?: ThemeCandidate[];
  lean?: Map<string, number>;
}) =>
  trackToOffer({
    themes: input.themes ?? THEMES,
    trackNames: input.trackNames ?? [],
    record: input.record ?? [],
    now: NOW,
    lean: input.lean,
  });

describe('the theme offered', () => {
  it('is the strongest one', () => {
    expect(offer({})).toEqual({
      themeId: 't-urban',
      name: 'Urban design',
      about: 'about Urban design',
      notes: 5,
    });
  });

  it('skips a theme you already have a track for, whatever its case', () => {
    expect(offer({ trackNames: ['urban DESIGN'] })?.themeId).toBe('t-agency');
  });

  it('never comes back once you said Never', () => {
    expect(offer({ record: [pressed('t-urban', 'Urban design', 'never', 200)] })?.themeId).toBe(
      't-agency',
    );
  });

  it('matches Never by name when a later sweep gave the theme a new id', () => {
    expect(offer({ record: [pressed('old-id', 'urban design', 'never')] })?.themeId).toBe(
      't-agency',
    );
  });

  it('is not offered again once started, even if the track was deleted since', () => {
    expect(offer({ record: [pressed('t-urban', 'Urban design', 'started', 90)] })?.themeId).toBe(
      't-agency',
    );
  });

  it('is held back for a few weeks after Not now, then comes round again', () => {
    expect(offer({ record: [pressed('t-urban', 'Urban design', 'not_now', 3)] })?.themeId).toBe(
      't-agency',
    );
    expect(offer({ record: [pressed('t-urban', 'Urban design', 'not_now', 30)] })?.themeId).toBe(
      't-urban',
    );
  });

  it('needs at least one note under it', () => {
    expect(offer({ themes: [theme('t-empty', 'Empty', 90, 0), ...THEMES] })?.themeId).toBe(
      't-urban',
    );
  });

  it('is nothing once every theme is taken or declined', () => {
    expect(
      offer({
        trackNames: ['Urban design'],
        record: [
          pressed('t-agency', 'Personal agency', 'never'),
          pressed('t-systems', 'Emergent systems', 'not_now', 1),
        ],
      }),
    ).toBeNull();
  });
});

describe('the lean towards tracks you engage with (plan #780)', () => {
  it('lifts a weaker theme near a track you answer past a stronger one', () => {
    expect(offer({ lean: new Map([['t-systems', 2]]) })?.themeId).toBe('t-systems');
  });

  it('pushes a theme near a track you skip below a weaker one', () => {
    expect(offer({ lean: new Map([['t-urban', 0.5]]) })?.themeId).toBe('t-agency');
  });
});

describe('running low', () => {
  it('is fewer than about ten ready ideas', () => {
    expect(runningLow(0)).toBe(true);
    expect(runningLow(LOW_WATER - 1)).toBe(true);
    expect(runningLow(LOW_WATER)).toBe(false);
  });
});

describe('the field you write about most and have never been tested in (plan #800)', () => {
  const FIELDS = [
    { id: 'f-econ', name: 'Economics' },
    { id: 'f-hist', name: 'History' },
    { id: 'f-phys', name: 'Physics' },
  ];
  const strengths = new Map([
    ['t-trade', 40],
    ['t-money', 30],
    ['t-rome', 50],
    ['t-quanta', 90],
    ['t-gone', 0],
  ]);
  const placements = [
    { themeId: 't-trade', fieldId: 'f-econ' },
    { themeId: 't-money', fieldId: 'f-econ' },
    { themeId: 't-rome', fieldId: 'f-hist' },
    { themeId: 't-quanta', fieldId: 'f-phys' },
    // A placement whose theme is no longer in the vault counts for nothing.
    { themeId: 't-missing', fieldId: 'f-hist' },
  ];

  it('picks the field with the most summed strength and no answered question', () => {
    const field = strongestUntestedField({
      fields: FIELDS,
      placements,
      strengths,
      tracks: [{ fieldId: 'f-phys', answered: true }],
    });
    expect(field).toEqual({ id: 'f-econ', name: 'Economics', themeIds: ['t-trade', 't-money'] });
  });

  it('keeps a field whose placed track has nothing answered yet', () => {
    const field = strongestUntestedField({
      fields: FIELDS,
      placements,
      strengths,
      tracks: [{ fieldId: 'f-phys', answered: false }],
    });
    expect(field?.name).toBe('Physics');
  });

  it('passes over a field whose only answered question came from the survey', () => {
    const field = strongestUntestedField({
      fields: FIELDS,
      placements,
      strengths,
      tracks: [{ fieldId: 'f-phys', answered: true }],
      surveyed: new Set(['f-econ']),
    });
    expect(field?.name).toBe('History');
  });

  it('is null when every field with themes has been tested', () => {
    const field = strongestUntestedField({
      fields: FIELDS,
      placements,
      strengths,
      tracks: ['f-econ', 'f-hist', 'f-phys'].map((fieldId) => ({ fieldId, answered: true })),
    });
    expect(field).toBeNull();
  });

  const economics = {
    name: 'Economics',
    themes: [theme('t-money', 'Money', 30), theme('t-trade', 'Trade', 40)],
  };

  it('offers the strongest theme in that field and names the field', () => {
    expect(
      trackToOffer({ themes: THEMES, trackNames: [], record: [], now: NOW, field: economics }),
    ).toEqual({
      themeId: 't-trade',
      name: 'Trade',
      about: 'about Trade',
      notes: 5,
      field: 'Economics',
    });
  });

  it('applies the same exclusions inside the field', () => {
    const picked = trackToOffer({
      themes: THEMES,
      trackNames: ['trade'],
      record: [],
      now: NOW,
      field: economics,
    });
    expect(picked).toMatchObject({ themeId: 't-money', field: 'Economics' });
  });

  it('falls back to the usual theme, with no field, when every theme in it is excluded', () => {
    const picked = trackToOffer({
      themes: THEMES,
      trackNames: [],
      record: [pressed('t-trade', 'Trade', 'never'), pressed('t-money', 'Money', 'not_now', 1)],
      now: NOW,
      field: economics,
    });
    expect(picked).toEqual(offer({}));
    expect(picked?.field).toBeUndefined();
  });

  it('offers the same theme as before, with no field, when no field qualifies', () => {
    const picked = trackToOffer({
      themes: THEMES,
      trackNames: [],
      record: [],
      now: NOW,
      field: null,
    });
    expect(picked).toEqual({
      themeId: 't-urban',
      name: 'Urban design',
      about: 'about Urban design',
      notes: 5,
    });
    expect(picked?.field).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { LOW_WATER, runningLow, trackToOffer, type OfferRecord, type ThemeCandidate } from './offer';

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

const offer = (input: { trackNames?: string[]; record?: OfferRecord[]; themes?: ThemeCandidate[] }) =>
  trackToOffer({
    themes: input.themes ?? THEMES,
    trackNames: input.trackNames ?? [],
    record: input.record ?? [],
    now: NOW,
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

describe('running low', () => {
  it('is fewer than about ten ready ideas', () => {
    expect(runningLow(0)).toBe(true);
    expect(runningLow(LOW_WATER - 1)).toBe(true);
    expect(runningLow(LOW_WATER)).toBe(false);
  });
});

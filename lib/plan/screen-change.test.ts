import { describe, expect, it } from 'vitest';
import {
  isBeforeShot,
  ownsShotPath,
  screenChanges,
  screenChangeViews,
  shotHref,
  type ScreenCheckRow,
} from './screen-change';

const USER = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685';
const at = '2026-10-06T10:00:00Z';

function shots(step: number, surface: string, round: number, names: string[]): string[] {
  return names.map((n) => `${USER}/${step}/${surface}/r${round}/${n}.png`);
}

function row(
  over: Partial<ScreenCheckRow> & Pick<ScreenCheckRow, 'surface' | 'round' | 'verdict'>,
): ScreenCheckRow {
  return { step: 1541, shots: [], created_at: at, ...over };
}

describe('screenChanges', () => {
  it('shows the last passing round, phone light, with the before beside it', () => {
    const out = screenChanges([
      row({
        surface: 'dev-plan-opened',
        round: 1,
        verdict: 'fix',
        shots: shots(1541, 'dev-plan-opened', 1, ['phone-light', 'before-phone-light']),
      }),
      row({
        surface: 'dev-plan-opened',
        round: 2,
        verdict: 'pass',
        created_at: '2026-10-06T12:00:00Z',
        shots: shots(1541, 'dev-plan-opened', 2, [
          'phone-dark',
          'phone-light',
          'laptop-light',
          'before-phone-dark',
          'before-phone-light',
        ]),
      }),
    ]);
    expect(out[1541]).toEqual([
      {
        surface: 'dev-plan-opened',
        round: 2,
        verdict: 'pass',
        checkedAt: '2026-10-06T12:00:00Z',
        before: `${USER}/1541/dev-plan-opened/r2/before-phone-light.png`,
        after: `${USER}/1541/dev-plan-opened/r2/phone-light.png`,
      },
    ]);
  });

  it('leaves out a surface that has not passed', () => {
    const out = screenChanges([row({ surface: 'dev-changelog', round: 1, verdict: 'fix' })]);
    expect(out).toEqual({});
  });

  it('keeps showing the last pass when a later round asks for fixes', () => {
    const out = screenChanges([
      row({ surface: 's', round: 1, verdict: 'pass', shots: shots(1541, 's', 1, ['phone-light']) }),
      row({ surface: 's', round: 2, verdict: 'fix', shots: shots(1541, 's', 2, ['phone-light']) }),
    ]);
    expect(out[1541][0]).toMatchObject({ round: 1, after: `${USER}/1541/s/r1/phone-light.png` });
  });

  it('shows an accepted round with the pictures of the round the person looked at', () => {
    const out = screenChanges([
      row({
        surface: 's',
        round: 3,
        verdict: 'fix',
        shots: shots(1541, 's', 3, ['phone-dark', 'before-phone-dark']),
      }),
      row({ surface: 's', round: 4, verdict: 'accepted' }),
    ]);
    expect(out[1541][0]).toMatchObject({
      round: 4,
      verdict: 'accepted',
      before: `${USER}/1541/s/r3/before-phone-dark.png`,
      after: `${USER}/1541/s/r3/phone-dark.png`,
    });
  });

  it('says there is no picture when the shots were not uploaded, and no before for a new surface', () => {
    const out = screenChanges([row({ surface: 's', round: 1, verdict: 'pass' })]);
    expect(out[1541][0]).toMatchObject({ before: null, after: null });
  });

  it('keeps each step apart', () => {
    const out = screenChanges([
      row({ step: 10, surface: 's', round: 1, verdict: 'pass' }),
      row({ step: 11, surface: 's', round: 1, verdict: 'fix' }),
      row({ step: 11, surface: 't', round: 1, verdict: 'pass' }),
    ]);
    expect(Object.keys(out).map(Number).sort()).toEqual([10, 11]);
    expect(out[11].map((c) => c.surface)).toEqual(['t']);
  });
});

describe('screenChangeViews', () => {
  it('turns bucket paths into links through the shot route', () => {
    const path = `${USER}/1541/s/r1/phone-light.png`;
    const views = screenChangeViews({
      1541: [{ surface: 's', round: 1, verdict: 'pass', checkedAt: at, before: null, after: path }],
    });
    expect(views[1541][0].after).toBe(shotHref(path));
    expect(views[1541][0].after).toBe(`/dev/ui/shot?path=${encodeURIComponent(path)}`);
    expect(views[1541][0].before).toBeNull();
  });
});

describe('shot paths', () => {
  it('tells a before shot from the round’s own', () => {
    expect(isBeforeShot(`${USER}/1/s/r1/before-phone-light.png`)).toBe(true);
    expect(isBeforeShot(`${USER}/1/s/r1/phone-light.png`)).toBe(false);
  });

  it('serves only a shot in the account’s own folder', () => {
    expect(ownsShotPath(USER, `${USER}/1541/dev-plan-opened/r2/phone-light.png`)).toBe(true);
    expect(ownsShotPath(USER, `someone-else/1541/s/r1/phone-light.png`)).toBe(false);
    expect(ownsShotPath(USER, `${USER}/../other/s/r1/phone-light.png`)).toBe(false);
    expect(ownsShotPath(USER, `${USER}/1541/s/r1/phone-light.jpg`)).toBe(false);
  });
});

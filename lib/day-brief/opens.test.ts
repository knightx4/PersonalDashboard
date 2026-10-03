import { describe, expect, it } from 'vitest';
import { briefDaysOpened, briefUrl, isDay, isPickKey, openedFromPush } from './opens';

const TODAY = '2026-09-30';

describe('recording an opened brief', () => {
  it('marks the notification URL with its day, ahead of the anchor', () => {
    expect(briefUrl('2026-09-30')).toBe('/home?brief=2026-09-30#brief');
  });

  it('records the notification day when the service worker opened the page', () => {
    // What public/sw.js turns briefUrl() into.
    const url = new URL(briefUrl('2026-09-29'), 'https://example.com');
    url.searchParams.set('from', 'push');
    expect(openedFromPush(Object.fromEntries(url.searchParams), TODAY)).toBe('2026-09-29');
  });

  it('counts a notification sent before the day was in its URL as today', () => {
    expect(openedFromPush({ from: 'push' }, TODAY)).toBe(TODAY);
  });

  it('records nothing when the home page is opened directly', () => {
    expect(openedFromPush({}, TODAY)).toBeNull();
    expect(openedFromPush({ brief: '2026-09-29' }, TODAY)).toBeNull();
    expect(openedFromPush({ from: 'mail', brief: '2026-09-29' }, TODAY)).toBeNull();
  });

  it('ignores a day that is not one', () => {
    expect(openedFromPush({ from: 'push', brief: '2026-02-30' }, TODAY)).toBeNull();
    expect(openedFromPush({ from: 'push', brief: 'yesterday' }, TODAY)).toBeNull();
    expect(openedFromPush({ from: ['push', 'x'], brief: ['2026-09-28'] }, TODAY)).toBe('2026-09-28');
  });

  it("counts today's brief as opened whenever Home shows it", () => {
    expect(briefDaysOpened(null, TODAY, true)).toEqual([TODAY]);
    expect(briefDaysOpened(TODAY, TODAY, true)).toEqual([TODAY]);
  });

  it('records nothing from a plain visit when there is no brief to show', () => {
    expect(briefDaysOpened(null, TODAY, false)).toEqual([]);
  });

  it("keeps an older notification's day alongside today's", () => {
    expect(briefDaysOpened('2026-09-29', TODAY, true)).toEqual(['2026-09-29', TODAY]);
    expect(briefDaysOpened('2026-09-29', TODAY, false)).toEqual(['2026-09-29']);
  });

  it('checks the shape of what the pick link sends', () => {
    expect(isDay('2026-09-30')).toBe(true);
    expect(isDay('2026-9-30')).toBe(false);
    expect(isPickKey('task:1b2c')).toBe(true);
    expect(isPickKey('  ')).toBe(false);
    expect(isPickKey('x'.repeat(301))).toBe(false);
    expect(isPickKey(42)).toBe(false);
  });
});

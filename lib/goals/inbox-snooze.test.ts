import { describe, expect, it } from 'vitest';
import type { TodayItem } from './today';
import { snoozeRefOf, withoutSnoozed } from './inbox-snooze';

const item = (kind: TodayItem['kind'], id: string): TodayItem => ({
  kind,
  id,
  title: id,
  detail: null,
  goalId: 'g',
  goalTitle: 'G',
  action: 'Do',
  unblocks: 0,
  on: null,
});
const ID = '11111111-1111-4111-8111-111111111111';
const now = new Date('2026-10-13T10:00:00Z');
const snooze = (until: string) => ({
  ref: `goals.items:${ID}`,
  snoozed_until: until,
  row_updated_at: '2026-10-12T09:00:00Z',
});

describe('snoozeRefOf', () => {
  it('names the table a kind lives in, and none for the rest', () => {
    expect(snoozeRefOf('step', ID)).toBe(`goals.items:${ID}`);
    expect(snoozeRefOf('flag', ID)).toBe(`public.raised_items:${ID}`);
    expect(snoozeRefOf('suggestion', ID)).toBeNull();
  });
});

describe('withoutSnoozed', () => {
  const stamps = new Map([[`goals.items:${ID}`, '2026-10-12T09:00:00Z']]);
  it('drops a row while its snooze holds', () => {
    expect(withoutSnoozed([item('step', ID)], [snooze('2026-10-16T00:00:00Z')], stamps, now)).toEqual([]);
  });
  it('shows it again, marked, once the day has come', () => {
    const [back] = withoutSnoozed([item('step', ID)], [snooze('2026-10-13T00:00:00Z')], stamps, now);
    expect(back.backFromSnooze).toBe(true);
  });
  it('shows it unmarked when the row changed, even before the day', () => {
    const changed = new Map([[`goals.items:${ID}`, '2026-10-13T09:00:00Z']]);
    const [shown] = withoutSnoozed([item('step', ID)], [snooze('2026-10-16T00:00:00Z')], changed, now);
    expect(shown.backFromSnooze).toBeUndefined();
  });
  it('leaves rows of other kinds alone', () => {
    expect(withoutSnoozed([item('suggestion', ID)], [snooze('2026-10-16T00:00:00Z')], stamps, now)).toHaveLength(1);
  });
});

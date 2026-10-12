import { describe, expect, it } from 'vitest';
import { isBackFromSnooze, isSnoozed, snoozeIndex } from './inbox-snoozes';

const snooze = { snoozed_until: '2026-10-16T00:00:00Z', row_updated_at: '2026-10-12T09:00:00Z' };
const now = new Date('2026-10-13T10:00:00Z');

describe('isSnoozed', () => {
  it('hides a row while the snooze is in force and the row is unchanged', () => {
    expect(isSnoozed(snooze, '2026-10-12T09:00:00Z', now)).toBe(true);
  });
  it('stops hiding once the day has come', () => {
    expect(isSnoozed(snooze, '2026-10-12T09:00:00Z', new Date('2026-10-16T00:00:00Z'))).toBe(false);
  });
  it('stops hiding when the row changed after it was snoozed', () => {
    expect(isSnoozed(snooze, '2026-10-12T09:00:01Z', now)).toBe(false);
  });
  it('hides nothing without a snooze', () => {
    expect(isSnoozed(null, '2026-10-12T09:00:00Z', now)).toBe(false);
  });
});

describe('isBackFromSnooze', () => {
  it('marks an expired snooze on an unchanged row only', () => {
    const later = new Date('2026-10-17T00:00:00Z');
    expect(isBackFromSnooze(snooze, '2026-10-12T09:00:00Z', later)).toBe(true);
    expect(isBackFromSnooze(snooze, '2026-10-14T09:00:00Z', later)).toBe(false);
    expect(isBackFromSnooze(snooze, '2026-10-12T09:00:00Z', now)).toBe(false);
  });
});

describe('snoozeIndex', () => {
  it('keys by ref', () => {
    const ref = 'public.plan_items:00000000-0000-4000-8000-000000000001';
    expect(snoozeIndex([{ ref, ...snooze }]).get(ref)?.snoozed_until).toBe(snooze.snoozed_until);
  });
});

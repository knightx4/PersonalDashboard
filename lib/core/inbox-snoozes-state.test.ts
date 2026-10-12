import { describe, expect, it } from 'vitest';
import { withoutSnoozed } from '@/lib/dev/inbox-snoozes';
import {
  laterStamp,
  parseSnoozeRef,
  pickedDayStart,
  snoozeChoices,
  snoozeRef,
  snoozeStateFrom,
} from './inbox-snoozes';

const id = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const now = new Date('2026-10-13T10:00:00Z');

describe('snooze refs', () => {
  it('round-trips a snoozable ref', () => {
    expect(parseSnoozeRef(snoozeRef('public.plan_items', id))).toEqual({
      table: 'public.plan_items',
      id,
    });
  });
  it('refuses other tables and ids that are not uuids', () => {
    expect(parseSnoozeRef(`public.ideas:${id}`)).toBeNull();
    expect(parseSnoozeRef('public.plan_items:nope')).toBeNull();
  });
});

describe('laterStamp', () => {
  it('takes the later of the row and its newest turn', () => {
    expect(laterStamp('2026-10-12T09:00:00Z', '2026-10-12T10:00:00Z')).toBe('2026-10-12T10:00:00Z');
    expect(laterStamp('2026-10-12T11:00:00Z', undefined)).toBe('2026-10-12T11:00:00Z');
  });
});

describe('snoozeStateFrom', () => {
  const a = snoozeRef('public.plan_items', id);
  const b = snoozeRef('public.raised_items', other);
  const snoozes = [
    { ref: a, snoozed_until: '2026-10-16T00:00:00Z', row_updated_at: '2026-10-12T09:00:00Z' },
    { ref: b, snoozed_until: '2026-10-13T00:00:00Z', row_updated_at: '2026-10-12T09:00:00Z' },
  ];

  it('hides a running snooze and marks an expired one as back', () => {
    const stamps = new Map([
      [a, '2026-10-12T09:00:00Z'],
      [b, '2026-10-12T09:00:00Z'],
    ]);
    const state = snoozeStateFrom(snoozes, stamps, now);
    expect([...state.hidden]).toEqual([a]);
    expect([...state.back]).toEqual([b]);
    expect(state.active).toEqual([{ ref: a, snoozedUntil: '2026-10-16T00:00:00Z' }]);
  });

  it('lifts a snooze when a new turn moved the stamp', () => {
    const stamps = new Map([[a, '2026-10-13T09:00:00Z']]);
    const state = snoozeStateFrom(snoozes, stamps, now);
    expect(state.hidden.size).toBe(0);
    expect(state.back.size).toBe(0);
  });

  it('filters rows by what is hidden', () => {
    const state = snoozeStateFrom(snoozes, new Map([[a, '2026-10-12T09:00:00Z']]), now);
    const rows = [{ id }, { id: other }];
    expect(withoutSnoozed(rows, (row) => snoozeRef('public.plan_items', row.id), state)).toEqual([
      { id: other },
    ]);
  });
});

describe('snooze days', () => {
  it('works tomorrow and next week out as local day starts', () => {
    const { tomorrow, nextWeek } = snoozeChoices(new Date(2026, 9, 13, 15, 30));
    expect(tomorrow).toEqual(new Date(2026, 9, 14));
    expect(nextWeek).toEqual(new Date(2026, 9, 20));
  });
  it('reads a picked day and refuses a bad one', () => {
    expect(pickedDayStart('2026-10-30')).toEqual(new Date(2026, 9, 30));
    expect(pickedDayStart('2026-02-31')).toBeNull();
    expect(pickedDayStart('')).toBeNull();
  });
});

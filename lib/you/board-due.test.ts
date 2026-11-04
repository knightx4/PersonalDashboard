import { describe, expect, it } from 'vitest';
import { dueNotices, duePayload } from './board-due';
import { tripwireDue, tripwireOf } from './board-tripwires';

const decided = {
  id: 'q1',
  question: 'Take the contract?',
  status: 'decided',
  decided_at: '2026-09-01T10:00:00Z',
  reviews: [] as unknown[],
  tripwire: null as unknown,
  notified: {},
};

describe('what the daily board notification announces (plan #2581.10)', () => {
  it('announces a check-back on its day and not before', () => {
    expect(dueNotices(decided, '2026-09-30')).toEqual([]);
    expect(dueNotices(decided, '2026-10-01')).toEqual([
      { questionId: 'q1', question: 'Take the contract?', kind: 'review', key: 'review:30' },
    ]);
  });

  it('announces each once, and not one already answered', () => {
    expect(dueNotices({ ...decided, notified: { 'review:30': 'x' } }, '2026-10-01')).toEqual([]);
    expect(dueNotices({ ...decided, reviews: [{ at: 30, outcome: 'well' }] }, '2026-10-01')).toEqual([]);
    expect(dueNotices({ ...decided, reviews: [{ at: 30, account: 'Written.' }] }, '2026-10-01')).toHaveLength(1);
  });

  it('announces only the 90-day one when both are open', () => {
    expect(dueNotices(decided, '2026-12-01').map((n) => n.key)).toEqual(['review:90']);
  });

  it('announces a watching tripwire on its date, again if it is set with a new date', () => {
    const wire = { condition: 'Fewer than two interviews', check_on: '2026-10-27', status: 'watching' };
    const row = { ...decided, decided_at: '2026-10-20T00:00:00Z', tripwire: wire };
    expect(dueNotices(row, '2026-10-26')).toEqual([]);
    expect(dueNotices(row, '2026-10-27').map((n) => n.key)).toEqual(['tripwire:2026-10-27']);
    expect(dueNotices({ ...row, notified: { 'tripwire:2026-10-27': 'x' } }, '2026-10-28')).toEqual([]);
    expect(dueNotices({ ...row, tripwire: { ...wire, check_on: '2026-11-10' } }, '2026-11-10')).toHaveLength(1);
    expect(dueNotices({ ...row, tripwire: { ...wire, status: 'cleared' } }, '2026-10-28')).toEqual([]);
  });

  it('writes one notification opening the Board tab', () => {
    const one = duePayload(
      [{ questionId: 'q1', question: 'Take the contract?', kind: 'review', key: 'review:30' }],
      '2026-10-01',
    );
    expect(one).toMatchObject({ title: 'How did your decision go?', url: '/you/board', tag: 'board-due-2026-10-01' });
    const two = duePayload(
      [
        { questionId: 'q1', question: 'Take the contract?', kind: 'review', key: 'review:30' },
        { questionId: 'q2', question: 'Move to Lisbon?', kind: 'tripwire', key: 'tripwire:2026-10-01' },
      ],
      '2026-10-01',
    );
    expect(two.title).toBe('2 decisions to check on');
    expect(two.body).toBe('Take the contract? · Move to Lisbon?');
  });
});

describe('tripwireOf', () => {
  it('reads the stored wire and when it is due', () => {
    const wire = tripwireOf({ condition: 'x', check_on: '2026-10-27' });
    expect(wire).toMatchObject({ status: 'watching', checkOn: '2026-10-27' });
    expect(tripwireDue(wire, '2026-10-27')).toBe(true);
    expect(tripwireDue(wire, '2026-10-26')).toBe(false);
    expect(tripwireOf({ check_on: '2026-10-27' })).toBeNull();
  });
});

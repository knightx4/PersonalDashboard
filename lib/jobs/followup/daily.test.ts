import { describe, expect, it } from 'vitest';
import { dueForFollowUp } from '@/lib/jobs/followup/daily';

const NOW = new Date('2026-10-26T12:00:00Z');
const row = (id: string, made: string, extra: { sent?: string; tried?: string } = {}) => ({
  id,
  submitted_at: extra.sent ?? null,
  created_at: made,
  follow_up_tried_at: extra.tried ?? null,
});

describe('which applications the daily run works', () => {
  it('counts an application with no sent date from when it was made', () => {
    expect(dueForFollowUp([row('a', '2026-10-14T09:00:00Z'), row('b', '2026-10-10T09:00:00Z')], NOW)).toEqual(['a']);
  });

  it('goes by the sent date when there is one', () => {
    expect(dueForFollowUp([row('a', '2026-10-25T09:00:00Z', { sent: '2026-10-01T09:00:00Z' })], NOW)).toEqual([]);
  });

  it('waits a week after a look that found nobody', () => {
    const rows = [
      row('recent', '2026-10-20T09:00:00Z', { tried: '2026-10-24T09:00:00Z' }),
      row('stale', '2026-10-20T09:00:00Z', { tried: '2026-10-18T09:00:00Z' }),
    ];
    expect(dueForFollowUp(rows, NOW)).toEqual(['stale']);
  });

  it('takes the newest five', () => {
    const rows = Array.from({ length: 7 }, (_, i) => row(`r${i}`, `2026-10-${String(15 + i).padStart(2, '0')}T09:00:00Z`));
    expect(dueForFollowUp(rows, NOW)).toEqual(['r6', 'r5', 'r4', 'r3', 'r2']);
  });
});

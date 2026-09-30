import { describe, expect, it } from 'vitest';
import { briefPayload } from '@/lib/push/send';
import { WEEK_REVIEW_TAG, weekReviewPayload } from './notify';

const observation = (text: string) => ({ text, goal_id: null, evidence: [], facts: [] });

describe('weekReviewPayload', () => {
  it('carries the first observation and opens the week page', () => {
    const payload = weekReviewPayload({
      week: '2026-09-27',
      observations: [observation('Notes written: 5 this week, against 2 the week before.'), observation('Second.')],
    });
    expect(payload).toEqual({
      title: 'Your week, from Dash',
      body: 'Notes written: 5 this week, against 2 the week before.',
      url: '/home/week/2026-09-27',
      tag: 'week-review',
    });
  });

  it('uses a tag the morning brief never uses, so neither replaces the other', () => {
    const brief = briefPayload('Three meetings today.', '2026-09-27');
    expect(brief.tag).not.toBe(WEEK_REVIEW_TAG);
  });

  it('sends nothing for a quiet week', () => {
    expect(weekReviewPayload({ week: '2026-09-27', observations: [] })).toBeNull();
    expect(weekReviewPayload({ week: '2026-09-27', observations: [observation('  ')] })).toBeNull();
  });

  it('trims a long observation', () => {
    const payload = weekReviewPayload({ week: '2026-09-27', observations: [observation('a'.repeat(1200))] });
    expect(payload?.body).toHaveLength(1000);
    expect(payload?.body.endsWith('…')).toBe(true);
  });
});

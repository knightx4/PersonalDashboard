import { describe, expect, it } from 'vitest';
import { mentorReplyPayload } from './mentor-reply-notice';

const MENTOR = { key: 'ada', name: 'Ada' };

describe('mentorReplyPayload (plan #2854.4)', () => {
  it('announces a reply nobody has read, opening the thread', () => {
    expect(
      mentorReplyPayload(MENTOR, { last_read_at: '2026-11-04T11:00:00Z' }, { text: 'Go for it.\nToday.', created_at: '2026-11-04T12:00:00Z', read_at: null }),
    ).toEqual({ title: 'Ada replied', body: 'Go for it. Today.', url: '/chat/people/ada', tag: 'mentor-ada' });
  });

  it('says nothing about a reply the open thread already read', () => {
    expect(mentorReplyPayload(MENTOR, {}, { text: 'Hi', created_at: '2026-11-04T12:00:00Z', read_at: '2026-11-04T12:00:01Z' })).toBeNull();
    expect(
      mentorReplyPayload(MENTOR, { last_read_at: '2026-11-04T12:00:02Z' }, { text: 'Hi', created_at: '2026-11-04T12:00:00Z', read_at: null }),
    ).toBeNull();
    expect(mentorReplyPayload(MENTOR, {}, null)).toBeNull();
  });

  it('announces a failed reply so it can be tried again', () => {
    expect(mentorReplyPayload(MENTOR, { reply_status: 'failed', reply_error: 'Cut off.' }, null)).toMatchObject({
      title: 'Ada could not reply',
      body: 'Cut off.',
    });
  });
});

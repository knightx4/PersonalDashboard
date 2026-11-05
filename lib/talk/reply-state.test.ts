import { describe, expect, it } from 'vitest';
import { askReplyPayload, REPLY_FAILED, REPLY_LOST, REPLY_LOST_AFTER_MS, replyStateOf, stopPressed } from './reply-state';

const NOW = Date.parse('2026-11-04T12:00:00Z');
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe('replyStateOf (plan #2854.4)', () => {
  it('says a reply is being written while it is within the time budget', () => {
    expect(replyStateOf({ reply_state: 'answering', reply_started_at: at(20_000) }, 'user', NOW)).toEqual({
      state: 'answering',
      startedAt: at(20_000),
    });
  });

  it('reads a reply still answering past the budget as failed, since its function is gone', () => {
    expect(replyStateOf({ reply_state: 'answering', reply_started_at: at(REPLY_LOST_AFTER_MS + 1) }, 'user', NOW)).toEqual({
      state: 'failed',
      error: REPLY_LOST,
    });
    expect(replyStateOf({ reply_state: 'answering', reply_started_at: null }, 'user', NOW)).toEqual({ state: 'failed', error: REPLY_LOST });
  });

  it('says why a reply failed, or a plain line when nothing was kept', () => {
    expect(replyStateOf({ reply_state: 'failed', reply_error: 'Dash could not answer: cut off.' }, 'user', NOW)).toEqual({
      state: 'failed',
      error: 'Dash could not answer: cut off.',
    });
    expect(replyStateOf({ reply_state: 'failed', reply_error: '  ' }, 'user', NOW)).toEqual({ state: 'failed', error: REPLY_FAILED });
  });

  it('has nothing waiting once Dash wrote the last turn, or when nothing is marked', () => {
    expect(replyStateOf({ reply_state: 'failed', reply_error: 'x' }, 'assistant', NOW)).toBeNull();
    expect(replyStateOf({ reply_state: null }, 'user', NOW)).toBeNull();
    expect(replyStateOf(null, 'user', NOW)).toBeNull();
  });
});

describe('stopPressed', () => {
  it('counts a Stop pressed on this reply, not one left from an earlier reply', () => {
    expect(stopPressed({ reply_stop_at: at(1_000) }, at(5_000))).toBe(true);
    expect(stopPressed({ reply_stop_at: at(9_000) }, at(5_000))).toBe(false);
    expect(stopPressed({ reply_stop_at: null }, at(5_000))).toBe(false);
  });
});

describe('askReplyPayload', () => {
  it('opens the chat and gives the answer as plain words', () => {
    const payload = askReplyPayload('c-1', { answer: '**Yes.** See [the role](/jobs/roles/1).\n\nMore.' });
    expect(payload).toEqual({ title: 'Dash answered', body: 'Yes. See the role. More.', url: '/chat/dash/c-1', tag: 'ask-c-1' });
  });

  it('says a failure as one', () => {
    expect(askReplyPayload('c-1', { error: 'Dash could not answer: cut off.' })).toMatchObject({
      title: 'Dash could not answer',
      body: 'Dash could not answer: cut off.',
    });
  });
});

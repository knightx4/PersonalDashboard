import { describe, expect, it } from 'vitest';
import { MAX_REPLY, parseReplyPayload } from './reply-payload';

describe('parseReplyPayload', () => {
  it('reads an answer', () => {
    expect(parseReplyPayload({ answer: 'B costs a migration.', needs_repo: false })).toEqual({
      kind: 'answer',
      body: 'B costs a migration.',
    });
  });

  it('reads a hand-off to a session', () => {
    expect(
      parseReplyPayload({ needs_repo: true, why: 'It depends what loadPlan selects today.' }),
    ).toEqual({ kind: 'needs_repo', why: 'It depends what loadPlan selects today.' });
  });

  it('says what it would read even when nothing said it', () => {
    const reply = parseReplyPayload({ needs_repo: true });
    expect(reply).toEqual({ kind: 'needs_repo', why: 'This one needs a look at the code.' });
  });

  it('does not let an answer ride along with a hand-off', () => {
    expect(parseReplyPayload({ answer: 'Probably four.', needs_repo: true, why: 'Have to count.' })).toEqual(
      { kind: 'needs_repo', why: 'Have to count.' },
    );
  });

  it('refuses an empty answer', () => {
    expect(parseReplyPayload({ answer: '   ' }).kind).toBe('error');
    expect(parseReplyPayload({}).kind).toBe('error');
  });

  it('refuses a payload of the wrong shape', () => {
    expect(parseReplyPayload({ answer: 12 }).kind).toBe('error');
    expect(parseReplyPayload(null).kind).toBe('error');
  });

  it('trims a reply the column would refuse', () => {
    const reply = parseReplyPayload({ answer: 'x'.repeat(MAX_REPLY + 500) });
    expect(reply.kind).toBe('answer');
    if (reply.kind !== 'answer') return;
    expect(reply.body).toHaveLength(MAX_REPLY);
    expect(reply.body.endsWith('…')).toBe(true);
  });
});

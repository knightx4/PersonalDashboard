import { describe, expect, it } from 'vitest';
import { handoffBrief, handoffRequest, MAX_HANDOFF_REQUEST } from './handoff';

describe('handoffRequest', () => {
  it('takes the request, trimmed', () => {
    expect(handoffRequest({ request: '  Create a goal  ' })).toEqual({
      ok: true,
      request: 'Create a goal',
      subjectRef: null,
    });
  });

  it('keeps the row it is about as a ref, only when Dash has seen that row (plan #1568)', () => {
    const about = { table: 'todo.tasks', ref: 't1' };
    const seen = (table: string, ref: string) => table === 'todo.tasks' && ref === 't1';
    expect(handoffRequest({ request: 'Split it in two', about }, seen)).toMatchObject({
      ok: true,
      subjectRef: 'todo.tasks:t1',
    });
    // A row no lookup returned is left out, and the request still goes on.
    expect(handoffRequest({ request: 'Split it in two', about: { table: 'todo.tasks', ref: 't9' } }, seen)).toEqual({
      ok: true,
      request: 'Split it in two',
      subjectRef: null,
    });
    expect(handoffRequest({ request: 'Split it in two', about: { table: 'Todo tasks', ref: 't1' } }, () => true))
      .toMatchObject({ subjectRef: null });
  });

  it('refuses a missing, blank or overlong request', () => {
    expect(handoffRequest({}).ok).toBe(false);
    expect(handoffRequest({ request: '   ' }).ok).toBe(false);
    expect(handoffRequest(null).ok).toBe(false);
    expect(handoffRequest({ request: 'x'.repeat(MAX_HANDOFF_REQUEST + 1) }).ok).toBe(false);
  });
});

describe('handoffBrief', () => {
  it('names the hand-off, the person and the conversation before the request', () => {
    const brief = handoffBrief({ id: 'h1', conversationId: 'c1', request: 'Create a goal' }, 'u1');
    expect(brief.split('\n')).toEqual(['Hand-off h1', 'user_id u1', 'conversation c1', '', 'Request: Create a goal']);
  });
});

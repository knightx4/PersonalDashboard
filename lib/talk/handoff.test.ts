import { describe, expect, it } from 'vitest';
import { handoffBrief, handoffRequest, MAX_HANDOFF_REQUEST } from './handoff';

describe('handoffRequest', () => {
  it('takes the request, trimmed', () => {
    expect(handoffRequest({ request: '  Create a goal  ' })).toEqual({ ok: true, request: 'Create a goal' });
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

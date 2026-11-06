import { describe, expect, it } from 'vitest';
import {
  handoffBrief,
  handoffKey,
  handoffRequest,
  handoffState,
  MAX_HANDOFF_REFS,
  MAX_HANDOFF_REQUEST,
  POST_NOT_HANDED_ON,
  sessionHandoffRow,
} from './handoff';

describe('handoffRequest', () => {
  it('refuses a request for a post, which Dash saves with suggest_post', () => {
    for (const request of ['Draft a post about the vault map', 'Write an X post about Learn', 'suggest some posts about the plan']) {
      expect(handoffRequest({ request })).toEqual({ ok: false, error: POST_NOT_HANDED_ON });
    }
    expect(handoffRequest({ request: 'Add a goal to publish a song' }).ok).toBe(true);
  });

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

describe('session hand-offs (plan #3005.1)', () => {
  const CHAT = '11111111-1111-4111-8111-111111111111';
  const BOT = '22222222-2222-4222-8222-222222222222';
  const ASK = '33333333-3333-4333-8333-333333333333';
  const MESSAGE = '44444444-4444-4444-8444-444444444444';
  const chat = { kind: 'chat' as const, chatId: CHAT, advisorId: BOT };

  it('reads pending as queued and fired as running', () => {
    expect(['pending', 'fired', 'done', 'failed'].map((s) => handoffState(s as never))).toEqual([
      'queued',
      'running',
      'done',
      'failed',
    ]);
  });

  it('keys a request by its thread and the message that asked, the same on a retry', () => {
    expect(handoffKey(chat, MESSAGE)).toBe(`you.advisor_chats:${CHAT}#${MESSAGE}`);
    expect(handoffKey({ kind: 'ask', conversationId: ASK }, MESSAGE)).toBe(`core.conversations:${ASK}#${MESSAGE}`);
    expect(handoffKey(chat, ` ${MESSAGE} `)).toBe(handoffKey(chat, MESSAGE));
  });

  it('builds the row for a People chat with the bot, the words, the summary and the refs', () => {
    const built = sessionHandoffRow('u1', {
      thread: chat,
      messageId: MESSAGE,
      request: ' Write plan step #3001 in full ',
      asked: 'can you flesh out 3001',
      summary: 'They are planning the hand-off feature.',
      refs: [
        { ref: 'public.plan_items:abc', note: 'the step' },
        { ref: 'not a ref' },
        { ref: 'public.plan_items:abc' },
      ],
      subjectRef: 'public.plan_items:abc',
    });
    expect(built).toEqual({
      ok: true,
      row: {
        user_id: 'u1',
        kind: 'session',
        conversation_id: null,
        advisor_chat_id: CHAT,
        advisor_id: BOT,
        message_id: MESSAGE,
        request: 'Write plan step #3001 in full',
        asked: 'can you flesh out 3001',
        summary: 'They are planning the hand-off feature.',
        refs: [{ ref: 'public.plan_items:abc', note: 'the step' }],
        subject_ref: 'public.plan_items:abc',
        request_key: `you.advisor_chats:${CHAT}#${MESSAGE}`,
      },
    });
  });

  it('puts an Ask Dash hand-off on its conversation with no bot', () => {
    const built = sessionHandoffRow('u1', {
      thread: { kind: 'ask', conversationId: ASK },
      messageId: 'turn-7',
      request: 'Research the company',
      asked: 'research them',
    });
    expect(built.ok && built.row).toMatchObject({
      conversation_id: ASK,
      advisor_chat_id: null,
      advisor_id: null,
      message_id: null,
      summary: null,
      refs: [],
      subject_ref: null,
    });
  });

  it('refuses a blank request, blank words, no message or a thread that is not a uuid', () => {
    const base = { thread: chat, messageId: MESSAGE, request: 'Do it', asked: 'do it' };
    expect(sessionHandoffRow('u1', { ...base, request: ' ' }).ok).toBe(false);
    expect(sessionHandoffRow('u1', { ...base, request: 'x'.repeat(MAX_HANDOFF_REQUEST + 1) }).ok).toBe(false);
    expect(sessionHandoffRow('u1', { ...base, asked: '' }).ok).toBe(false);
    expect(sessionHandoffRow('u1', { ...base, messageId: '' }).ok).toBe(false);
    expect(sessionHandoffRow('u1', { ...base, thread: { ...chat, chatId: 'c1' } }).ok).toBe(false);
  });

  it('keeps at most fifty refs', () => {
    const refs = Array.from({ length: MAX_HANDOFF_REFS + 5 }, (_, i) => ({ ref: `todo.tasks:${i}` }));
    const built = sessionHandoffRow('u1', { thread: chat, messageId: MESSAGE, request: 'x', asked: 'x', refs });
    expect(built.ok && built.row.refs).toHaveLength(MAX_HANDOFF_REFS);
  });
});

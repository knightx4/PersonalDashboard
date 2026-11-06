import { describe, expect, it, vi } from 'vitest';
import { botHandoffEndUpdate, botHandoffKey, botHandoffRow, cleanPacket, type BotHandoffInput } from './bot-handoff';

vi.mock('server-only', () => ({}));
const { endBotHandoff, keepBotHandoff, pickUpBotHandoff } = await import('./bot-handoffs');

const ZENA = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const CHAT = '33333333-3333-4333-8333-333333333333';
const MESSAGE = '44444444-4444-4444-8444-444444444444';

const INPUT: BotHandoffInput = {
  fromBot: ZENA,
  toBot: BOB,
  source: { kind: 'direct', chatId: CHAT, botKey: 'zena' },
  sourceMessageId: MESSAGE,
  request: 'OK, tell Bob that I want you to build it this way',
  packet: {
    summary: 'Fish Audio against ElevenLabs for voice in the chats.',
    findings: ['Fish Audio is $0.015 per 1k characters', '  '],
    decisions: ['Fish Audio, kept under $5 a month'],
    refs: [{ ref: 'public.plan_items:abc', note: 'the voice feature' }, { ref: 'not a ref' }, { ref: 'public.plan_items:abc' }],
  },
};

describe('botHandoffRow (plan #3003.1)', () => {
  it('keeps the bots, the thread and its link, the words and the packet', () => {
    const built = botHandoffRow('u1', INPUT);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.row).toMatchObject({
      user_id: 'u1',
      from_bot: ZENA,
      to_bot: BOB,
      source_kind: 'direct',
      source_id: CHAT,
      source_link: '/chat/people/zena',
      source_message_id: MESSAGE,
      request: INPUT.request,
    });
    expect(built.row.packet).toEqual({
      summary: 'Fish Audio against ElevenLabs for voice in the chats.',
      findings: ['Fish Audio is $0.015 per 1k characters'],
      decisions: ['Fish Audio, kept under $5 a month'],
      refs: [{ ref: 'public.plan_items:abc', note: 'the voice feature' }],
    });
  });

  it('links each kind of thread to its page', () => {
    const ask = botHandoffRow('u1', { ...INPUT, fromBot: null, source: { kind: 'ask', conversationId: CHAT } });
    const group = botHandoffRow('u1', { ...INPUT, source: { kind: 'group', chatId: CHAT } });
    expect(ask.ok && ask.row.source_link).toBe(`/chat/dash/${CHAT}`);
    expect(group.ok && group.row.source_link).toBe(`/chat/groups/${CHAT}`);
  });

  it('refuses no words, a bot handing to itself, and ids that are not ids', () => {
    expect(botHandoffRow('u1', { ...INPUT, request: '  ' }).ok).toBe(false);
    expect(botHandoffRow('u1', { ...INPUT, toBot: ZENA }).ok).toBe(false);
    expect(botHandoffRow('u1', { ...INPUT, fromBot: null, toBot: null }).ok).toBe(false);
    expect(botHandoffRow('u1', { ...INPUT, toBot: 'bob' }).ok).toBe(false);
    expect(botHandoffRow('u1', { ...INPUT, source: { kind: 'group', chatId: 'c1' } }).ok).toBe(false);
  });
});

describe('botHandoffKey', () => {
  const source = INPUT.source;

  it('is the same when the person repeats the request in other spacing or case', () => {
    expect(botHandoffKey(source, BOB, 'Tell Bob to build it this way.')).toBe(
      botHandoffKey(source, BOB, '  tell bob   to build it this way! '),
    );
  });

  it('differs by thread, receiver and words', () => {
    const key = botHandoffKey(source, BOB, 'build it');
    expect(botHandoffKey({ kind: 'group', chatId: CHAT }, BOB, 'build it')).not.toBe(key);
    expect(botHandoffKey(source, null, 'build it')).not.toBe(key);
    expect(botHandoffKey(source, BOB, 'write it up')).not.toBe(key);
    expect(key.length).toBeLessThanOrEqual(300);
  });
});

describe('cleanPacket', () => {
  it('drops what is not text and keeps an empty packet empty', () => {
    expect(cleanPacket({})).toEqual({});
    expect(cleanPacket({ summary: ' ', findings: [1, 'x'] as never })).toEqual({ findings: ['x'] });
  });
});

describe('botHandoffEndUpdate', () => {
  const AT = '2026-11-06T10:00:00.000Z';

  it('ends done with the result and the row made', () => {
    expect(botHandoffEndUpdate({ status: 'done', result: 'Added #3010', row: { table: 'public.plan_items', id: 'p1' } }, AT)).toEqual({
      ok: true,
      update: { status: 'done', done_at: AT, result: 'Added #3010', result_table: 'public.plan_items', result_id: 'p1' },
    });
  });

  it('needs a result for done and a reason for failed, and a real table', () => {
    expect(botHandoffEndUpdate({ status: 'done', result: ' ' }, AT).ok).toBe(false);
    expect(botHandoffEndUpdate({ status: 'failed', error: '' }, AT).ok).toBe(false);
    expect(botHandoffEndUpdate({ status: 'done', result: 'x', row: { table: 'plan_items', id: 'p1' } }, AT).ok).toBe(false);
    expect(botHandoffEndUpdate({ status: 'dropped' }, AT)).toEqual({ ok: true, update: { status: 'dropped', done_at: AT, error: null } });
  });
});

/** A stand-in for the core client: records each call and answers from `answers` in order. */
function fakeCore(answers: { data: unknown; error: null }[]) {
  const calls: { op: string; args: unknown[] }[] = [];
  const core = {
    from(table: string) {
      calls.push({ op: 'from', args: [table] });
      const chain: Record<string, unknown> = {};
      for (const op of ['select', 'upsert', 'update', 'eq', 'in', 'is', 'order', 'limit']) {
        chain[op] = (...args: unknown[]) => {
          calls.push({ op, args });
          return chain;
        };
      }
      chain.maybeSingle = () => Promise.resolve(answers.shift());
      chain.then = (resolve: (value: unknown) => unknown) => resolve(answers.shift());
      return chain;
    },
  };
  return { core: core as never, calls };
}

const KEPT = {
  id: 'h1',
  from_bot: ZENA,
  to_bot: BOB,
  source_kind: 'direct',
  source_id: CHAT,
  source_link: '/chat/people/zena',
  source_message_id: MESSAGE,
  request: INPUT.request,
  packet: {},
  status: 'sent',
  sent_at: '2026-11-06T10:00:00Z',
  picked_up_at: null,
  done_at: null,
  result: null,
  result_table: null,
  result_id: null,
  error: null,
  dedupe_key: 'k',
};

describe('keepBotHandoff', () => {
  it('returns the new row as created', async () => {
    const { core, calls } = fakeCore([{ data: [KEPT], error: null }]);
    const kept = await keepBotHandoff(core, 'u1', INPUT);
    expect(kept).toMatchObject({ ok: true, created: true, handoff: { id: 'h1', status: 'sent' } });
    expect(calls.find((c) => c.op === 'upsert')?.args[1]).toEqual({ onConflict: 'user_id,dedupe_key', ignoreDuplicates: true });
  });

  it('returns the row already kept when the same request comes again', async () => {
    const { core } = fakeCore([
      { data: [], error: null },
      { data: KEPT, error: null },
    ]);
    const kept = await keepBotHandoff(core, 'u1', INPUT);
    expect(kept).toMatchObject({ ok: true, created: false, handoff: { id: 'h1' } });
  });
});

describe('moving a hand-off on', () => {
  it('picks up only a sent one, and ends only an open one', async () => {
    const pick = fakeCore([{ data: [], error: null }]);
    expect(await pickUpBotHandoff(pick.core, 'u1', 'h1')).toBeNull();
    expect(pick.calls).toContainEqual({ op: 'eq', args: ['status', 'sent'] });

    const end = fakeCore([{ data: [{ ...KEPT, status: 'done', result: 'Added #3010' }], error: null }]);
    const ended = await endBotHandoff(end.core, 'u1', 'h1', { status: 'done', result: 'Added #3010' });
    expect(ended).toMatchObject({ ok: true, handoff: { status: 'done', result: 'Added #3010' } });
    expect(end.calls).toContainEqual({ op: 'in', args: ['status', ['sent', 'picked_up']] });
    expect(end.calls).toContainEqual({ op: 'eq', args: ['user_id', 'u1'] });
  });
});

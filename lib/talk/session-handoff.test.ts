import { describe, expect, it, vi } from 'vitest';
import { POST_NOT_HANDED_ON, sessionHandoffRow, type SessionHandoffInput } from './handoff';
import {
  notHandedOn,
  ON_IT,
  ON_IT_ALREADY,
  sessionHandoffInput,
  sessionRequest,
  startSessionHandoff,
  type SessionAsker,
  type SessionHandoffPorts,
} from './session-handoff';

const CHAT = '11111111-1111-4111-8111-111111111111';
const GERT = '22222222-2222-4222-8222-222222222222';
const MESSAGE = '33333333-3333-4333-8333-333333333333';

const asker: SessionAsker = {
  thread: { kind: 'chat', chatId: CHAT, advisorId: GERT },
  messageId: MESSAGE,
  asked: 'Can you write up the export step properly?',
  botName: 'Gert',
  href: '/chat/people/gert',
};

const seen = (table: string, ref: string) => table === 'public.plan_items' && ref === 'p1';

describe('sessionRequest', () => {
  it('reads the request, the summary and the refs a lookup returned', () => {
    expect(
      sessionRequest(
        {
          request: '  Add a plan step for the export  ',
          summary: ' They want CSV. ',
          refs: [
            { table: 'public.plan_items', ref: 'p1', note: 'the feature' },
            { table: 'public.plan_items', ref: 'made-up' },
            { table: 'Plan items', ref: 'p1' },
          ],
          about: { table: 'public.plan_items', ref: 'p1' },
        },
        seen,
      ),
    ).toEqual({
      ok: true,
      request: 'Add a plan step for the export',
      summary: 'They want CSV.',
      refs: [{ ref: 'public.plan_items:p1', note: 'the feature' }],
      subjectRef: 'public.plan_items:p1',
      browserTask: false,
    });
  });

  it('reads browser as a browser task only when it is true (plan #3040.1)', () => {
    const read = (browser: unknown) => {
      const parsed = sessionRequest({ request: 'Check the opening hours on their site', browser });
      return parsed.ok && parsed.browserTask;
    };
    expect(read(true)).toBe(true);
    expect(read(false)).toBe(false);
    expect(read('yes')).toBe(false);
    expect(read(undefined)).toBe(false);
  });

  it('refuses what Ask hand-off refuses', () => {
    expect(sessionRequest({ request: '' }).ok).toBe(false);
    expect(sessionRequest({ request: 'Draft a post about the vault map' })).toEqual({ ok: false, error: POST_NOT_HANDED_ON });
  });
});

describe('sessionHandoffInput', () => {
  it('puts the thread first among the refs, naming the bot and its link, and makes a valid row', () => {
    const input = sessionHandoffInput(asker, {
      request: 'Add a step',
      summary: null,
      refs: [{ ref: 'public.plan_items:p1' }],
      subjectRef: null,
      browserTask: true,
    });
    expect(input.refs).toEqual([
      { ref: `you.advisor_chats:${CHAT}`, note: 'The thread this was asked in, with Gert: /chat/people/gert' },
      { ref: 'public.plan_items:p1' },
    ]);
    const row = sessionHandoffRow('u1', input);
    expect(row.ok && row.row).toMatchObject({
      kind: 'session',
      advisor_id: GERT,
      advisor_chat_id: CHAT,
      asked: asker.asked,
      request_key: `you.advisor_chats:${CHAT}#${MESSAGE}`,
      browser_task: true,
    });
  });
});

describe('startSessionHandoff', () => {
  function ports(created: boolean, launched: { ok: true } | { ok: false; error: string } = { ok: true }) {
    const kept: SessionHandoffInput[] = [];
    const keep = vi.fn(async (input: SessionHandoffInput) => {
      kept.push(input);
      return { ok: true as const, handoff: { id: 'h1' }, created };
    });
    const launch = vi.fn(async () => launched);
    const p: SessionHandoffPorts = { keep, launch };
    return { p, kept, keep, launch };
  }

  it('keeps the row, starts a session and tells the bot to say it is on it', async () => {
    const { p, kept, launch } = ports(true);
    const result = await startSessionHandoff(p, asker, { request: 'Add a step' });
    expect(kept[0].asked).toBe(asker.asked);
    expect(launch).toHaveBeenCalledWith({ id: 'h1' }, asker);
    expect(result).toEqual({ told: { ok: true, rows: [], note: ON_IT }, kept: { handoff: { id: 'h1' }, created: true } });
  });

  it('starts nothing for a request kept before, and the bot still says it is on it', async () => {
    const { p, launch } = ports(false);
    const result = await startSessionHandoff(p, asker, { request: 'Add a step' });
    expect(launch).not.toHaveBeenCalled();
    expect(result.told).toEqual({ ok: true, rows: [], note: ON_IT_ALREADY });
  });

  it('says plainly when the session would not start, and never to try again', async () => {
    const { p } = ports(true, { ok: false, error: '401' });
    const result = await startSessionHandoff(p, asker, { request: 'Add a step' });
    expect(result.told).toEqual({ ok: true, rows: [], note: notHandedOn('the session that does it would not start.') });
    expect(notHandedOn('x')).toMatch(/do not ask them to try again/);
  });

  it('says so when the row could not be kept, and starts nothing', async () => {
    const launch = vi.fn();
    const result = await startSessionHandoff(
      { keep: async () => Promise.reject(new Error('down')), launch },
      asker,
      { request: 'Add a step' },
    );
    expect(launch).not.toHaveBeenCalled();
    expect(result).toEqual({ told: { ok: true, rows: [], note: notHandedOn('the request could not be saved.') }, kept: null });
  });

  it('keeps without starting when no launch is given, as Ask Dash does until its answer is kept', async () => {
    const result = await startSessionHandoff({ keep: async () => ({ ok: true, handoff: { id: 'h1' }, created: true }) }, asker, { request: 'Add a step' });
    expect(result.told).toEqual({ ok: true, rows: [], note: ON_IT });
  });
});

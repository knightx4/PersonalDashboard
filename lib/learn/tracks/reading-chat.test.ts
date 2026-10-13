import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { answerWithCut, CHAT_CUT_LINE, CHAT_UNREADABLE, readingMaterial } from './reading-chat';
import { UNREADABLE_ACTION } from './reading-summary';
import { answerAboutReading, READING_CHAT_MODEL } from './reading-chat-model';

describe('the chat on a reading (plan #1876.5)', () => {
  it('says once, on the first answer, that a long reading was cut at 200,000 characters', () => {
    expect(CHAT_CUT_LINE).toContain('200,000');
    expect(answerWithCut('Answer.', { truncated: true, earlierDash: [] })).toBe(
      `${CHAT_CUT_LINE}\n\nAnswer.`,
    );
    expect(
      answerWithCut('Again.', { truncated: true, earlierDash: [`${CHAT_CUT_LINE}\n\nAnswer.`] }),
    ).toBe('Again.');
    expect(answerWithCut(' Whole. ', { truncated: false, earlierDash: [] })).toBe('Whole.');
  });

  it('says what to paste when the reading cannot be read', () => {
    expect(CHAT_UNREADABLE).toContain(UNREADABLE_ACTION);
    expect(CHAT_UNREADABLE).not.toMatch(/claude/i);
  });

  it('gives the model the summary and says when the text was cut', () => {
    const material = readingMaterial({
      title: 'Elasticity',
      why: null,
      summary: 'A summary.',
      text: 'Body.',
      truncated: true,
    });
    expect(material).toContain('The summary you wrote of it earlier:\nA summary.');
    expect(material).toContain('only the first 200,000 characters');
    expect(material.endsWith('<reading>\nBody.\n</reading>')).toBe(true);
    expect(
      readingMaterial({ title: 'T', why: ' ', summary: null, text: 'x', truncated: false }),
    ).not.toMatch(/Why|summary|cut/);
  });
});

describe('answerAboutReading', () => {
  function fakeClient(reply: string | Error) {
    const create = vi.fn(async (request: unknown) => {
      void request;
      if (reply instanceof Error) throw reply;
      return {
        content: [{ type: 'text', text: reply }],
        usage: { input_tokens: 1_000, output_tokens: 100 },
      };
    });
    return { create, client: { messages: { create } } as never };
  }

  it('answers the thread, caches the reading, and reports what it spent', async () => {
    const { client, create } = fakeClient(' It says so in 5.1. ');
    const spent: unknown[] = [];
    const result = await answerAboutReading({
      material: 'Title: T\n\n<reading>\nx\n</reading>',
      turns: [
        { role: 'user', body: 'First?' },
        { role: 'assistant', body: 'One.' },
        { role: 'user', body: 'Second?' },
      ],
      anthropicApiKey: 'k',
      client,
      onSpend: (report) => spent.push(report),
    });
    expect(result).toEqual({ ok: true, text: 'It says so in 5.1.' });
    expect((spent[0] as { model: string }).model).toBe(READING_CHAT_MODEL);
    const request = create.mock.calls[0][0] as {
      system: { text: string; cache_control?: unknown }[];
      messages: unknown[];
    };
    expect(request.system[1]).toMatchObject({
      text: 'Title: T\n\n<reading>\nx\n</reading>',
      cache_control: { type: 'ephemeral' },
    });
    expect(request.messages).toHaveLength(3);
  });

  it('spends nothing when there is no question to answer or the call throws', async () => {
    const spent: unknown[] = [];
    const none = await answerAboutReading({
      material: 'm',
      turns: [{ role: 'assistant', body: 'Hello.' }],
      anthropicApiKey: 'k',
      client: fakeClient('x').client,
      onSpend: (report) => spent.push(report),
    });
    expect(none.ok).toBe(false);
    const thrown = await answerAboutReading({
      material: 'm',
      turns: [{ role: 'user', body: 'Q?' }],
      anthropicApiKey: 'k',
      client: fakeClient(new Error('overloaded')).client,
      onSpend: (report) => spent.push(report),
    });
    expect(thrown).toEqual({ ok: false, detail: 'overloaded' });
    expect(spent).toHaveLength(0);
  });
});

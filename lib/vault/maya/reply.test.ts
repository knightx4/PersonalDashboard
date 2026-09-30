import { describe, expect, it } from 'vitest';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { MAYA_REPLY_MODEL, MAYA_SUMMARY_MAX, replyInThread, replyMessages, replySystem } from './reply';

/**
 * Maya's reply in a thread with a fake model client (plan #1286): what is
 * sent, and what comes back as the reply and the new summary.
 */

type Reply = { content: unknown[] };

function fakeClient(reply: Reply, calls: Record<string, unknown>[] = []) {
  return {
    messages: {
      create: async (body: Record<string, unknown>) => {
        calls.push(structuredClone(body));
        return { usage: { input_tokens: 6_000, output_tokens: 700 }, stop_reason: 'tool_use', ...reply };
      },
    },
  } as unknown as NonNullable<Parameters<typeof replyInThread>[0]['client']>;
}

function answer(input: unknown): Reply {
  return { content: [{ type: 'tool_use', id: 't1', name: 'answer', input }] };
}

const base = {
  note: { title: 'On finding yourself', body: 'Action is how the self is found.' },
  question: 'Is the self found by acting or by looking inward?',
  thought: '1. Your essay puts action last.',
  summary: null,
};

describe('replyMessages', () => {
  it('starts with the person, joins runs of one role and leaves out a leading answer of Maya', () => {
    expect(
      replyMessages([
        { role: 'maya', body: 'An opening.' },
        { role: 'person', body: 'First.' },
        { role: 'person', body: 'Second.' },
        { role: 'maya', body: 'An answer.' },
        { role: 'person', body: '  ' },
        { role: 'person', body: 'Third.' },
      ]),
    ).toEqual([
      { role: 'user', content: 'First.\n\nSecond.' },
      { role: 'assistant', content: 'An answer.' },
      { role: 'user', content: 'Third.' },
    ]);
  });
});

describe('replySystem', () => {
  it('carries the note, the question, the thought and the summary', () => {
    const system = replySystem({ ...base, summary: 'You hold that acting comes first.' });
    expect(system).toContain('Title: On finding yourself');
    expect(system).toContain('Action is how the self is found.');
    expect(system).toContain(base.question);
    expect(system).toContain('Your essay puts action last.');
    expect(system).toContain('You hold that acting comes first.');
    expect(system).toContain('You are Maya');
    expect(system).not.toContain('Dash');
  });

  it('says so when the note or the thought is missing', () => {
    const system = replySystem({ ...base, note: null, thought: null });
    expect(system).toContain('no longer in their vault');
    expect(system).toContain('was not kept');
  });
});

describe('replyInThread', () => {
  it('returns the reply and the new summary, and reports the spend', async () => {
    const calls: Record<string, unknown>[] = [];
    const spent: SpendReport[] = [];
    const result = await replyInThread({
      ...base,
      turns: [{ role: 'person', body: 'But I only know what I did once I look back.' }],
      client: fakeClient(answer({ reply: 'Looking back is itself an act.', summary: 'You now hold both.' }), calls),
      onSpend: (report) => spent.push(report),
    });
    expect(result).toEqual({ ok: true, reply: 'Looking back is itself an act.', summary: 'You now hold both.' });
    expect(calls[0]?.model).toBe(MAYA_REPLY_MODEL);
    expect(calls[0]?.tool_choice).toEqual({ type: 'tool', name: 'answer' });
    expect(calls[0]?.messages).toEqual([{ role: 'user', content: 'But I only know what I did once I look back.' }]);
    expect(spent).toHaveLength(1);
    expect(spent[0]?.model).toBe(MAYA_REPLY_MODEL);
  });

  it('keeps the summary there was when the new one comes back empty, and cuts a long one', async () => {
    const kept = await replyInThread({
      ...base,
      summary: 'Where you were.',
      turns: [{ role: 'person', body: 'Yes.' }],
      client: fakeClient(answer({ reply: 'Good.', summary: '  ' })),
    });
    expect(kept).toMatchObject({ ok: true, summary: 'Where you were.' });

    const long = await replyInThread({
      ...base,
      turns: [{ role: 'person', body: 'Yes.' }],
      client: fakeClient(answer({ reply: 'Good.', summary: 'x'.repeat(MAYA_SUMMARY_MAX + 50) })),
    });
    expect(long.ok && long.summary.length).toBe(MAYA_SUMMARY_MAX);
  });

  it('refuses a thread whose last turn is not the person’s, and an empty reply', async () => {
    const calls: Record<string, unknown>[] = [];
    const none = await replyInThread({
      ...base,
      turns: [
        { role: 'person', body: 'Hi.' },
        { role: 'maya', body: 'Hello.' },
      ],
      client: fakeClient(answer({ reply: 'x', summary: 'y' }), calls),
    });
    expect(none.ok).toBe(false);
    expect(calls).toHaveLength(0);

    const empty = await replyInThread({
      ...base,
      turns: [{ role: 'person', body: 'Hi.' }],
      client: fakeClient(answer({ reply: ' ', summary: 'y' })),
    });
    expect(empty).toEqual({ ok: false, detail: 'The reply came back empty.' });
  });
});

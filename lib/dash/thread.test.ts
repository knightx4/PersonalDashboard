import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { ASK_VOICE } from './ask';
import { ACKNOWLEDGE_ALONE, ACKNOWLEDGE_TOOL, NO_ACKNOWLEDGE, runDash } from './loop';
import { CHANGED_SO_ANSWER, replyInThread, THREAD_RULES, threadVoice, type ThreadDash } from './thread';

/**
 * Dash marking a comment seen in place of a reply (plan #1649): a thread may
 * end its turn with acknowledge, never after a change, and Ask Dash never.
 */

const USAGE = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

type Sent = { tools: { name: string }[]; messages: { content: unknown }[] };

function client(replies: unknown[]) {
  const sent: Sent[] = [];
  return {
    sent,
    client: {
      messages: {
        create: async (params: Sent) => {
          sent.push(structuredClone(params));
          return replies[sent.length - 1];
        },
      },
    } as unknown as Anthropic,
  };
}

const call = (...uses: [id: string, name: string, input: unknown][]) => ({
  content: uses.map(([id, name, input]) => ({ type: 'tool_use', id, name, input })),
  stop_reason: 'tool_use',
  usage: USAGE,
});

/** The last tool result sent back to the model. */
function lastResult(sent: Sent[]): { content: string; is_error?: boolean }[] {
  return sent.at(-1)!.messages.at(-1)!.content as { content: string; is_error?: boolean }[];
}

const dash: ThreadDash = {
  today: '2026-10-08',
  execute: async () => ({ ok: true, rows: [] }),
  apply: async (tool, input, _seen, acts) => acts(tool.name, input),
  saveChange: async () => undefined,
};

const voice = threadVoice('test-model', 'Dev rules.', 'public.ideas');

function reply(stub: Anthropic, acknowledge: (() => Promise<unknown>) | undefined, message: string) {
  return replyInThread({
    voice,
    subject: { ref: 'public.ideas:i1', title: 'An idea' },
    message,
    dash,
    acts: async (name) => ({ ok: true, recorded: true, kind: name, said: 'Filed the idea "Dark mode".' }),
    acknowledge,
    anthropicApiKey: 'k',
    client: stub,
  });
}

describe('acknowledging a comment in a thread', () => {
  it('offers acknowledge before answer on a thread, and never to Ask Dash', async () => {
    const { client: stub, sent } = client([call(['k1', ACKNOWLEDGE_TOOL, {}])]);
    await reply(stub, vi.fn(async () => '2026-10-08T10:00:00Z'), 'pushed the fix, all good now');
    expect(sent[0].tools.map((t) => t.name).slice(-2)).toEqual([ACKNOWLEDGE_TOOL, 'answer']);
    expect(ASK_VOICE.acknowledge).toBeFalsy();
    expect(ASK_VOICE.system).not.toContain('acknowledge');
  });

  it('marks the comment seen and writes no reply when Dash chooses it', async () => {
    const { client: stub, sent } = client([call(['k1', ACKNOWLEDGE_TOOL, {}])]);
    const acknowledge = vi.fn(async () => '2026-10-08T10:00:00Z');
    const result = await reply(stub, acknowledge, 'pushed the fix, all good now');
    expect(acknowledge).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
    expect(result).toEqual({ ok: true, body: '', citations: [], made: [], passedOn: false, acknowledged: true });
  });

  it('still replies in words when Dash answers a question', async () => {
    const { client: stub } = client([call(['a1', 'answer', { answer: 'Yes, it shipped on Monday.', cited: [] }])]);
    const acknowledge = vi.fn();
    const result = await reply(stub, acknowledge, 'did this ship?');
    expect(acknowledge).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, body: 'Yes, it shipped on Monday.', acknowledged: false });
  });

  it('refuses the mark once Dash has made a change, and the change is said in words', async () => {
    const { client: stub, sent } = client([
      call(['w1', 'file_idea', { text: 'Dark mode' }]),
      call(['k1', ACKNOWLEDGE_TOOL, {}]),
      call(['a1', 'answer', { answer: 'Filed it as its own idea.', cited: [] }]),
    ]);
    const acknowledge = vi.fn();
    const result = await reply(stub, acknowledge, 'file dark mode as its own idea');
    expect(acknowledge).not.toHaveBeenCalled();
    expect(sent).toHaveLength(3);
    expect(lastResult(sent)[0]).toMatchObject({ content: CHANGED_SO_ANSWER, is_error: true });
    expect(result).toMatchObject({
      ok: true,
      body: 'Filed it as its own idea.\n\nFiled the idea "Dark mode".',
      made: ['file_idea'],
      acknowledged: false,
    });
  });

  it('refuses the mark called beside another tool, and runs the other', async () => {
    const { client: stub, sent } = client([
      call(['w1', 'file_idea', { text: 'Dark mode' }], ['k1', ACKNOWLEDGE_TOOL, {}]),
      call(['a1', 'answer', { answer: 'Filed it.', cited: [] }]),
    ]);
    const acknowledge = vi.fn();
    const result = await reply(stub, acknowledge, 'file dark mode as its own idea');
    expect(acknowledge).not.toHaveBeenCalled();
    expect(lastResult(sent)[1]).toMatchObject({ content: ACKNOWLEDGE_ALONE, is_error: true });
    expect(result).toMatchObject({ ok: true, made: ['file_idea'], acknowledged: false });
  });

  it('answers in words when the thread gives no way to mark the comment', async () => {
    const { client: stub, sent } = client([
      call(['k1', ACKNOWLEDGE_TOOL, {}]),
      call(['a1', 'answer', { answer: 'Glad it works.', cited: [] }]),
    ]);
    const result = await reply(stub, undefined, 'pushed the fix, all good now');
    expect(lastResult(sent)[0]).toMatchObject({ content: NO_ACKNOWLEDGE, is_error: true });
    expect(result).toMatchObject({ ok: true, body: 'Glad it works.', acknowledged: false });
  });

  it('refuses the mark on Ask Dash even when a handler is given', async () => {
    const { client: stub, sent } = client([
      call(['k1', ACKNOWLEDGE_TOOL, {}]),
      call(['a1', 'answer', { answer: 'Glad it works.', cited: [] }]),
    ]);
    const acknowledge = vi.fn(async () => ({ ok: true as const }));
    const answer = await runDash({
      voice: ASK_VOICE,
      context: { surface: 'ask', subject: null, page: null },
      turns: [{ role: 'user', body: 'thanks' }],
      today: '2026-10-08',
      execute: vi.fn(),
      acknowledge,
      anthropicApiKey: 'k',
      client: stub,
    });
    expect(acknowledge).not.toHaveBeenCalled();
    expect(lastResult(sent)[0]).toMatchObject({ content: NO_ACKNOWLEDGE, is_error: true });
    expect(answer).toMatchObject({ ok: true, body: 'Glad it works.' });
    expect(answer).not.toHaveProperty('acknowledged');
  });

  it('teaches the choice with comments that need words and comments that do not', () => {
    expect(THREAD_RULES).toContain('call acknowledge instead');
    expect(THREAD_RULES).toContain('A question is never only marked seen');
    expect(THREAD_RULES).toContain('"pushed the fix, all good now": acknowledge.');
    expect(THREAD_RULES).toContain('"done with this one?": answer; it is a question.');
  });
});

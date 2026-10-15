import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { runDash, scopeLine, type DashContext, type DashVoice } from './loop';
import { dashTool } from './registry';
import { STOPPED_NOTE } from '@/lib/talk/talk';

/** Stop, rows added with @ and a scope (plan #1899.5), on the shared loop. */

const USAGE = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function client(replies: unknown[]) {
  const sent: unknown[] = [];
  return {
    sent,
    client: {
      messages: {
        create: async (params: unknown) => {
          sent.push(structuredClone(params));
          return replies[sent.length - 1];
        },
      },
    } as unknown as Anthropic,
  };
}

const call = (id: string, name: string, input: unknown) => ({
  content: [{ type: 'tool_use', id, name, input }],
  stop_reason: 'tool_use',
  usage: USAGE,
});

const voice: DashVoice = { model: 'test-model', system: 'Rules.', tools: [dashTool('todos')!] };
const context: DashContext = { surface: 'ask', subject: null, page: null };
const turns = [{ role: 'user' as const, body: 'What did I pay for the Catan lot?' }];

const start = (id: string, name: string) => ({
  type: 'content_block_start',
  index: 0,
  content_block: { type: 'tool_use', id, name, input: {} },
});
const delta = (partial_json: string) => ({
  type: 'content_block_delta',
  index: 0,
  delta: { type: 'input_json_delta', partial_json },
});

describe('stopping an answer', () => {
  it('ends the call in flight and keeps what was written, with the stop said', async () => {
    const stopping = new AbortController();
    let signalled: AbortSignal | undefined;
    const stub = {
      messages: {
        stream: (_params: unknown, options?: { signal?: AbortSignal }) => {
          signalled = options?.signal;
          const heard: ((event: unknown) => void)[] = [];
          return {
            on(name: string, fn: (event: unknown) => void) {
              if (name === 'streamEvent') heard.push(fn);
              return this;
            },
            async finalMessage() {
              for (const event of [start('a1', 'answer'), delta('{"answer": "You paid $186.00 for')]) {
                for (const fn of heard) fn(event);
              }
              // The person presses Stop here, and the SDK rejects the call.
              stopping.abort();
              throw new Error('Request was aborted.');
            },
          };
        },
      },
    } as unknown as Anthropic;
    const answer = await runDash({
      voice,
      context,
      turns,
      today: '2026-10-14',
      execute: vi.fn(),
      anthropicApiKey: 'k',
      client: stub,
      onText: () => {},
      signal: stopping.signal,
    });
    expect(signalled).toBe(stopping.signal);
    expect(answer).toMatchObject({ ok: true, stop: 'stopped', body: `You paid $186.00 for\n\n${STOPPED_NOTE}` });
  });

  it('starts no further call or lookup once stopped', async () => {
    const stopping = new AbortController();
    const { client: stub, sent } = client([call('l1', 'todos', {}), call('a1', 'answer', { answer: 'Never sent.', cited: [] })]);
    const execute = vi.fn(async () => {
      stopping.abort();
      return { ok: true as const, rows: [] };
    });
    const answer = await runDash({
      voice,
      context,
      turns,
      today: '2026-10-14',
      execute,
      anthropicApiKey: 'k',
      client: stub,
      signal: stopping.signal,
    });
    expect(sent).toHaveLength(1);
    expect(answer).toMatchObject({ ok: true, stop: 'stopped', body: STOPPED_NOTE });
    expect(answer.ok && answer.toolCalls.map((c) => c.name)).toEqual(['todos']);
  });

  it('runs to its end with no signal, as threads and capture call it', async () => {
    const { client: stub } = client([call('a1', 'answer', { answer: 'Done.', cited: [] })]);
    const answer = await runDash({ voice, context, turns, today: '2026-10-14', execute: vi.fn(), anthropicApiKey: 'k', client: stub });
    expect(answer).toMatchObject({ ok: true, stop: 'answered', body: 'Done.' });
  });
});

describe('rows added with @ and a scope', () => {
  it('tells the model the rows on a question, and lets the answer cite them', async () => {
    const row = { table: 'public.orders', ref: 'o1', title: 'Catan lot, eBay', href: '/shopping/orders/o1' };
    const { client: stub, sent } = client([
      call('a1', 'answer', { answer: 'That is the Catan lot.', cited: [{ table: 'public.orders', ref: 'o1' }] }),
    ]);
    const answer = await runDash({
      voice,
      context,
      turns: [{ role: 'user', body: 'What did I pay for this?', citations: [row] }],
      today: '2026-10-14',
      execute: vi.fn(),
      anthropicApiKey: 'k',
      client: stub,
    });
    const asked = JSON.stringify((sent[0] as { messages: unknown[] }).messages);
    expect(asked).toContain('Rows I added for you to read');
    expect(asked).toContain('public.orders o1');
    expect(answer.ok && answer.citations).toEqual([row]);
  });

  it('tells the model the workspace a question is kept to', async () => {
    const { client: stub, sent } = client([call('a1', 'answer', { answer: 'Nothing.', cited: [] })]);
    await runDash({
      voice,
      context: { ...context, scope: 'Learn' },
      turns,
      today: '2026-10-14',
      execute: vi.fn(),
      anthropicApiKey: 'k',
      client: stub,
    });
    const system = (sent[0] as { system: { text: string }[] }).system.map((b) => b.text);
    expect(system).toContain(scopeLine('Learn'));
  });
});

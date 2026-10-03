import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { runDash, type DashContext, type DashVoice } from './loop';
import { dashTool, type DashWriteTool } from './registry';

/**
 * The shared loop's routing by kind (plan #1463). Ask's own behaviour on it
 * is covered in ask.test.ts; this covers what Ask does not use: a write tool,
 * and a surface that leaves a kind out.
 */

const USAGE = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function client(replies: unknown[]) {
  const sent: { tools: { name: string }[] }[] = [];
  return {
    sent,
    client: {
      messages: {
        create: async (params: { tools: { name: string }[] }) => {
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

const ADD_GOAL: DashWriteTool = {
  name: 'add_goal',
  kind: 'write',
  definition: { name: 'add_goal', description: 'Add a goal.', input_schema: { type: 'object', properties: {} } },
  apply: async () => ({ ok: false, error: 'not run in this test' }),
};

const voice: DashVoice = { model: 'test-model', system: 'Rules.', tools: [dashTool('todos')!, ADD_GOAL] };
const context: DashContext = { surface: 'thread', subject: { ref: 'goals.items:g1' }, page: null };
const turns = [{ role: 'user' as const, body: 'Add a goal to run a marathon.' }];

describe('runDash', () => {
  it('sends the voice tools then answer, and routes a write tool to the writer', async () => {
    const { client: stub, sent } = client([
      call('w1', 'add_goal', { title: 'Run a marathon' }),
      call('a1', 'answer', { answer: 'Added it.', cited: [] }),
    ]);
    const write = vi.fn(async () => ({ ok: true as const, rows: [], note: 'Added.' }));
    const execute = vi.fn();
    const answer = await runDash({
      voice,
      context,
      turns,
      today: '2026-10-03',
      execute,
      write,
      anthropicApiKey: 'k',
      client: stub,
    });
    expect(sent[0].tools.map((t) => t.name)).toEqual(['todos', 'add_goal', 'answer']);
    expect(write).toHaveBeenCalledWith(ADD_GOAL, { title: 'Run a marathon' }, expect.any(Function));
    expect(execute).not.toHaveBeenCalled();
    expect(answer).toMatchObject({ ok: true, body: 'Added it.', stop: 'answered' });
  });

  it('refuses a write where the surface gives no writer, and the answer still comes', async () => {
    const { client: stub } = client([
      call('w1', 'add_goal', {}),
      call('a1', 'answer', { answer: 'I cannot add that here.', cited: [] }),
    ]);
    const answer = await runDash({
      voice,
      context,
      turns,
      today: '2026-10-03',
      execute: vi.fn(),
      anthropicApiKey: 'k',
      client: stub,
    });
    expect(answer.ok && answer.toolCalls[0]).toMatchObject({
      name: 'add_goal',
      result: { ok: false, error: 'Changes cannot be made here. Answer in words.' },
    });
  });

  it('makes the writes that come with the answer before answering, and skips lookups beside it', async () => {
    const { client: stub, sent } = client([
      {
        content: [
          { type: 'tool_use', id: 'w1', name: 'add_goal', input: { title: 'Run a marathon' } },
          { type: 'tool_use', id: 'l1', name: 'todos', input: {} },
          { type: 'tool_use', id: 'a1', name: 'answer', input: { answer: 'Added it.', cited: [] } },
        ],
        stop_reason: 'tool_use',
        usage: USAGE,
      },
    ]);
    const write = vi.fn(async () => ({ ok: true as const, rows: [], note: 'Added.' }));
    const execute = vi.fn();
    const answer = await runDash({
      voice,
      context,
      turns,
      today: '2026-10-03',
      execute,
      write,
      anthropicApiKey: 'k',
      client: stub,
    });
    expect(sent).toHaveLength(1);
    expect(write).toHaveBeenCalledWith(ADD_GOAL, { title: 'Run a marathon' }, expect.any(Function));
    expect(execute).not.toHaveBeenCalled();
    expect(answer).toMatchObject({ ok: true, body: 'Added it.', stop: 'answered' });
    expect(answer.ok && answer.toolCalls.map((c) => c.name)).toEqual(['add_goal']);
  });
});

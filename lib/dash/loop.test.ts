import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { dateLine, runDash, type DashContext, type DashVoice } from './loop';
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

describe('a voice with server tools and its own ending (plan #1479, Maya)', () => {
  const REPORT: Anthropic.Tool = {
    name: 'report_thought',
    description: 'Report the thought.',
    input_schema: { type: 'object', properties: { question: { type: 'string' } } },
  };
  const SEARCH = { type: 'web_search_20260209', name: 'web_search', max_uses: 2 } as unknown as Anthropic.ToolUnion;
  const maya: DashVoice = { model: 'opus', system: 'Maya.', tools: [], serverTools: [SEARCH], finish: REPORT };
  const execute = vi.fn(async () => ({ ok: false as const, error: 'none' }));

  it('lets the model choose, sends a paused turn back, asks once for the ending, and returns it with the cited passages', async () => {
    const { client: stub, sent } = client([
      { content: [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: {} }], stop_reason: 'pause_turn', usage: USAGE },
      {
        content: [
          {
            type: 'text',
            text: 'Hesse wrote it.',
            citations: [{ type: 'web_search_result_location', cited_text: 'Each man is a road.' }],
          },
        ],
        stop_reason: 'end_turn',
        usage: USAGE,
      },
      call('r1', 'report_thought', { question: 'Who are you?' }),
    ]);
    const answer = await runDash({
      voice: maya,
      context,
      turns,
      today: '2026-10-03',
      execute,
      anthropicApiKey: 'k',
      client: stub,
    });

    expect(sent.map((s) => (s as unknown as { tool_choice: unknown }).tool_choice)).toEqual([
      { type: 'auto' },
      { type: 'auto' },
      { type: 'tool', name: 'report_thought' },
    ]);
    expect(sent[0]!.tools.map((t) => t.name)).toEqual(['web_search', 'report_thought']);
    expect(answer).toMatchObject({ ok: true, body: '', report: { question: 'Who are you?' }, webCited: ['Each man is a road.'] });
    expect(execute).not.toHaveBeenCalled();
  });

  it('fails rather than taking prose as the ending', async () => {
    const { client: stub } = client([
      { content: [{ type: 'text', text: 'Thinking.' }], stop_reason: 'end_turn', usage: USAGE },
      { content: [{ type: 'text', text: 'Still thinking.' }], stop_reason: 'end_turn', usage: USAGE },
    ]);
    const answer = await runDash({ voice: maya, context, turns, today: '2026-10-03', execute, anthropicApiKey: 'k', client: stub });
    expect(answer.ok).toBe(false);
  });
});

describe('the date line (note de8e7fbb)', () => {
  it('spells out the weekday and tomorrow', () => {
    expect(dateLine('2026-10-04')).toBe(
      "Today is Sunday, 4 October 2026 (2026-10-04) in the person's timezone, and tomorrow is " +
        'Monday, 5 October 2026 (2026-10-05). Read "tomorrow", "this month", "last week" and the like from it.',
    );
  });

  it('crosses a month end', () => {
    expect(dateLine('2026-10-31')).toContain('tomorrow is Sunday, 1 November 2026 (2026-11-01)');
  });
});

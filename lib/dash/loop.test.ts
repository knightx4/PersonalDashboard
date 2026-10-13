import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { answerSoFar, dateLine, LOOK_FIRST, runDash, type DashContext, type DashVoice } from './loop';
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
      { type: 'auto' },
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

describe('answerSoFar', () => {
  it('reads the answer field as far as it has arrived, escapes decoded', () => {
    expect(answerSoFar('')).toBe('');
    expect(answerSoFar('{"answ')).toBe('');
    expect(answerSoFar('{"answer": "')).toBe('');
    expect(answerSoFar('{"answer": "You spent')).toBe('You spent');
    expect(answerSoFar('{"answer":"Line one\\nThe \\"Catan\\" lot')).toBe('Line one\nThe "Catan" lot');
    expect(answerSoFar('{"answer": "caf\\u00e9 done", "cited": [')).toBe('café done');
  });

  it('holds back an escape cut in half, so what it returns only grows', () => {
    expect(answerSoFar('{"answer": "a\\')).toBe('a');
    expect(answerSoFar('{"answer": "a\\u00')).toBe('a');
  });

  it('reads the top level only, past fields written before it', () => {
    const json = '{"cited": [{"table": "t", "ref": "{\\"answer\\": \\"no\\"}"}], "answer": "Yes';
    expect(answerSoFar(json)).toBe('Yes');
    expect(answerSoFar('{"cited": [{"table": "t"')).toBe('');
  });
});

describe('runDash with onText', () => {
  /** A client whose stream plays each round's events and ends with its message. */
  function streaming(rounds: { events: unknown[]; message: unknown }[]) {
    const sent: { tools: { name: string; eager_input_streaming?: boolean }[] }[] = [];
    const stub = {
      messages: {
        create: async () => {
          throw new Error('a streamed run must not make a plain request');
        },
        stream: (params: { tools: { name: string }[] }) => {
          sent.push(structuredClone(params));
          const round = rounds[sent.length - 1];
          const heard: ((event: unknown) => void)[] = [];
          return {
            on(name: string, fn: (event: unknown) => void) {
              if (name === 'streamEvent') heard.push(fn);
              return this;
            },
            async finalMessage() {
              for (const event of round.events) for (const fn of heard) fn(event);
              return round.message;
            },
          };
        },
      },
    } as unknown as Anthropic;
    return { stub, sent };
  }

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

  it('hands out the answer as it is written, and returns the answer as kept', async () => {
    const { stub, sent } = streaming([
      {
        events: [start('a1', 'answer'), delta('{"answer": "You sp'), delta('ent $41'), delta('2.60 on \\"flips\\".", "cited": []}')],
        message: call('a1', 'answer', { answer: 'You spent $412.60 on "flips".', cited: [] }),
      },
    ]);
    const heard: string[] = [];
    const answer = await runDash({
      voice,
      context,
      turns,
      today: '2026-10-03',
      execute: vi.fn(),
      anthropicApiKey: 'k',
      client: stub,
      onText: (piece) => heard.push(piece),
    });
    expect(heard).toEqual(['You sp', 'ent $41', '2.60 on "flips".']);
    expect(answer.ok && answer.body).toBe('You spent $412.60 on "flips".');
    const tools = sent[0].tools;
    expect(tools.find((t) => t.name === 'answer')?.eager_input_streaming).toBe(true);
    expect(tools.find((t) => t.name === 'todos')?.eager_input_streaming).toBeUndefined();
  });

  it('says nothing for a lookup round, and a listener that throws loses nothing', async () => {
    const { stub } = streaming([
      { events: [start('t1', 'todos'), delta('{"answer": "no"}')], message: call('t1', 'todos', {}) },
      {
        events: [start('a1', 'answer'), delta('{"answer": "None due."')],
        message: call('a1', 'answer', { answer: 'None due.', cited: [] }),
      },
    ]);
    const execute = vi.fn(async () => ({ ok: true as const, rows: [] }));
    const heard: string[] = [];
    const answer = await runDash({
      voice,
      context,
      turns,
      today: '2026-10-03',
      execute,
      anthropicApiKey: 'k',
      client: stub,
      onText: (piece) => {
        heard.push(piece);
        throw new Error('listener broke');
      },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(heard).toEqual(['None due.']);
    expect(answer.ok && answer.body).toBe('None due.');
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

describe('a refusal before looking', () => {
  const ask = [{ role: 'user' as const, body: 'Give me a good video to watch.' }];
  const refuse = (id: string) =>
    call(id, 'answer', { answer: 'I cannot browse YouTube.', cited: [], could_not: 'pick a video: no way to browse YouTube' });

  it('is sent back once to look first, and the answer after the lookup stands', async () => {
    const { client: stub, sent } = client([
      refuse('a1'),
      call('l1', 'todos', {}),
      call('a2', 'answer', { answer: 'Watch this one.', cited: [] }),
    ]);
    const execute = vi.fn(async () => ({ ok: true as const, rows: [] }));
    const answer = await runDash({ voice, context, turns: ask, today: '2026-10-07', execute, anthropicApiKey: 'k', client: stub });
    expect(sent).toHaveLength(3);
    const back = (sent[1] as unknown as { messages: { content: unknown }[] }).messages.at(-1)!.content;
    expect(back).toEqual([expect.objectContaining({ type: 'tool_result', tool_use_id: 'a1', content: LOOK_FIRST, is_error: true })]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(answer).toMatchObject({ ok: true, body: 'Watch this one.' });
    expect(answer.ok && answer.couldNot).toBeFalsy();
  });

  it('stands the second time, carrying what could not be done', async () => {
    const { client: stub, sent } = client([refuse('a1'), refuse('a2')]);
    const answer = await runDash({ voice, context, turns: ask, today: '2026-10-07', execute: vi.fn(), anthropicApiKey: 'k', client: stub });
    expect(sent).toHaveLength(2);
    expect(answer).toMatchObject({ ok: true, body: 'I cannot browse YouTube.', couldNot: 'pick a video: no way to browse YouTube' });
  });

  it('stands at once after a lookup', async () => {
    const { client: stub, sent } = client([call('l1', 'todos', {}), refuse('a1')]);
    const execute = vi.fn(async () => ({ ok: true as const, rows: [] }));
    const answer = await runDash({ voice, context, turns: ask, today: '2026-10-07', execute, anthropicApiKey: 'k', client: stub });
    expect(sent).toHaveLength(2);
    expect(answer).toMatchObject({ ok: true, couldNot: 'pick a video: no way to browse YouTube' });
  });
});

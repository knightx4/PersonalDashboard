import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { CUT_OFF, keepGoing, LIMIT_AGAIN, runDash, TIME_BUDGET_MS, type DashContext, type DashVoice } from './loop';
import { dashTool, type DashWriteTool } from './registry';

/**
 * A chat that stops short of a change it was asked for (plan #2999): a reply
 * cut off mid-call is not run, and a turn that reaches a limit gets one more
 * stretch before it must answer.
 */

const USAGE = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

type Sent = { max_tokens: number; tool_choice: { type: string }; messages: { role: string; content: unknown }[] };

/** A stub client whose clock moves on at each call, by `steps[i]` milliseconds at the i-th. */
function client(replies: unknown[], clock: { at: number }, steps: number[] = []) {
  const sent: Sent[] = [];
  return {
    sent,
    client: {
      messages: {
        create: async (params: Sent) => {
          sent.push(structuredClone(params));
          clock.at += steps[sent.length - 1] ?? 0;
          return replies[sent.length - 1];
        },
      },
    } as unknown as Anthropic,
  };
}

const call = (id: string, name: string, input: unknown, stop = 'tool_use') => ({
  content: [{ type: 'tool_use', id, name, input }],
  stop_reason: stop,
  usage: USAGE,
});

const ADD_GOAL: DashWriteTool = {
  name: 'add_goal',
  kind: 'write',
  runs: { none: 'A fixture.' },
  definition: { name: 'add_goal', description: 'Add a goal.', input_schema: { type: 'object', properties: {} } },
  apply: async () => ({ ok: false, error: 'not run in this test' }),
};

const base: DashVoice = { model: 'test-model', system: 'Rules.', tools: [dashTool('todos')!, ADD_GOAL] };
const context: DashContext = { surface: 'thread', subject: null, page: null };
const turns = [{ role: 'user' as const, body: 'Add a goal to run a marathon.' }];

/** Every text block the last turn sent holds. */
function lastTexts(sent: Sent): string[] {
  const last = sent.messages[sent.messages.length - 1];
  if (typeof last.content === 'string') return [last.content];
  return (last.content as { type: string; text?: string }[]).filter((b) => b.type === 'text').map((b) => b.text ?? '');
}

describe('a reply cut off mid-call (plan #2999)', () => {
  it('runs nothing from it, says so, raises the limit and runs the call made again', async () => {
    const clock = { at: 0 };
    const { client: stub, sent } = client(
      [
        call('w1', 'add_goal', { title: 'Run a marathon' }, 'max_tokens'),
        call('w2', 'add_goal', { title: 'Run a marathon', detail: 'In full.' }),
        call('a1', 'answer', { answer: 'Added it.', cited: [] }),
      ],
      clock,
    );
    const write = vi.fn(async () => ({ ok: true as const, rows: [], note: 'Added.' }));
    const answer = await runDash({
      voice: { ...base, maxTokens: 1200 },
      context,
      turns,
      today: '2026-11-05',
      execute: vi.fn(),
      write,
      anthropicApiKey: 'k',
      client: stub,
      now: () => clock.at,
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(ADD_GOAL, { title: 'Run a marathon', detail: 'In full.' }, expect.any(Function));
    expect(sent[0].max_tokens).toBe(1200);
    expect(sent[1].max_tokens).toBe(8000);
    expect(answer.ok && answer.toolCalls[0]).toMatchObject({ name: 'add_goal', result: { ok: false, error: CUT_OFF } });
    expect(answer).toMatchObject({ ok: true, body: 'Added it.', stop: 'answered' });
  });
});

describe('one more stretch at a limit (plan #2999)', () => {
  it('lets a turn that ran out of time make the change it was asked for, and says it was extended', async () => {
    const clock = { at: 0 };
    const { client: stub, sent } = client(
      [
        call('l1', 'todos', {}),
        call('w1', 'add_goal', { title: 'Run a marathon' }),
        call('a1', 'answer', { answer: 'Added it.', cited: [] }),
      ],
      clock,
      [TIME_BUDGET_MS + 1],
    );
    const write = vi.fn(async () => ({ ok: true as const, rows: [], note: 'Added.' }));
    const answer = await runDash({
      voice: { ...base, extend: true },
      context,
      turns,
      today: '2026-11-05',
      execute: vi.fn(async () => ({ ok: true as const, rows: [] })),
      write,
      anthropicApiKey: 'k',
      client: stub,
      now: () => clock.at,
    });
    expect(lastTexts(sent[1])).toContain(keepGoing('time'));
    expect(sent[1].tool_choice.type).not.toBe('tool');
    expect(write).toHaveBeenCalledTimes(1);
    expect(answer).toMatchObject({ ok: true, body: 'Added it.', stop: 'answered', extended: true });
  });

  it('makes it answer, saying what is not done, when it runs out again', async () => {
    const clock = { at: 0 };
    const { client: stub, sent } = client(
      [call('l1', 'todos', {}), call('l2', 'todos', {}), call('a1', 'answer', { answer: 'The goal is not added yet.', cited: [] })],
      clock,
      [TIME_BUDGET_MS + 1, 2 * TIME_BUDGET_MS],
    );
    const answer = await runDash({
      voice: { ...base, extend: true },
      context,
      turns,
      today: '2026-11-05',
      execute: vi.fn(async () => ({ ok: true as const, rows: [] })),
      write: vi.fn(),
      anthropicApiKey: 'k',
      client: stub,
      now: () => clock.at,
    });
    expect(lastTexts(sent[1])).toContain(keepGoing('time'));
    expect(lastTexts(sent[2])).toContain(LIMIT_AGAIN);
    expect(answer).toMatchObject({ ok: true, stop: 'time', extended: true });
  });

  it('answers at the first limit for a voice that does not extend, as before', async () => {
    const clock = { at: 0 };
    const { client: stub, sent } = client(
      [call('l1', 'todos', {}), call('a1', 'answer', { answer: 'Here is what I found.', cited: [] })],
      clock,
      [TIME_BUDGET_MS + 1],
    );
    const answer = await runDash({
      voice: base,
      context,
      turns,
      today: '2026-11-05',
      execute: vi.fn(async () => ({ ok: true as const, rows: [] })),
      anthropicApiKey: 'k',
      client: stub,
      now: () => clock.at,
    });
    expect(sent).toHaveLength(2);
    expect(answer).toMatchObject({ ok: true, stop: 'time' });
    expect(answer.ok && answer.extended).toBeUndefined();
  });
});

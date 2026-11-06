import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { OPUS } from '@/lib/core/models';
import type { NewTalkTurn, TalkTurn } from '@/lib/talk/talk';
import { askDash, type AskStores } from './ask';
import { failureRow, UNFINISHED_REASON, type DashFailure } from './failures';
import { NOTES_ONLY } from './loop';
import { dashHealth } from './quality/health';
import { replyInThread, threadVoice, type ThreadDash } from './thread';

/**
 * Every failed Dash answer is kept with its reason and each call (plan
 * #2937.2): Ask, a thread reply, and the daily health check that raises them.
 */

const USAGE = { input_tokens: 1000, output_tokens: 7350, cache_read_input_tokens: 400, cache_creation_input_tokens: 50 };

function stub(replies: unknown[]) {
  let n = 0;
  return {
    messages: {
      create: async () => {
        const next = replies[n++];
        if (!next) throw new Error('no reply scripted');
        return next;
      },
    },
  } as unknown as Anthropic;
}

function memoryStores() {
  const failures: DashFailure[] = [];
  let n = 0;
  const stores: AskStores = {
    start: async (question) => ({ kind: 'ask', ref: 'conv-new', title: question }),
    load: async () => [],
    append: async (_subject, turns: readonly NewTalkTurn[]) =>
      turns.map((t): TalkTurn => ({ id: `t${++n}`, role: t.role, body: t.body, createdAt: '2026-11-05T10:00:00Z' })),
    recordSpend: async () => {},
    saveProposal: async () => {
      throw new Error('no proposals here');
    },
    attachProposals: async () => {},
    discardProposals: async () => {},
    recordFailure: async (failure) => {
      failures.push(failure);
    },
  };
  return { stores, failures };
}

const execute = async () => ({ ok: true as const, rows: [] });

describe('a failed Ask answer is kept (plan #2937.2)', () => {
  it('keeps the reason, the model and each call when no answer comes back', async () => {
    const { stores, failures } = memoryStores();
    const client = stub([{ content: [{ type: 'text', text: 'Hmm' }], stop_reason: 'max_tokens', usage: USAGE }]);
    const result = await askDash({ question: 'Anything?', today: '2026-11-05', execute, anthropicApiKey: 'k', client }, stores);

    expect(result.error).toMatch(/^Dash could not answer/);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      surface: 'ask',
      outcome: 'failed',
      conversationId: 'conv-new',
      turnId: 't1',
      think: false,
      calls: [{ stop: 'max_tokens', blocks: ['text'], outputTokens: 7350, inputTokens: 1000, cachedInputTokens: 400, cacheWriteTokens: 50 }],
    });
    expect(failures[0].reason).toMatch(/cut off/);
  });

  it('keeps a call that threw, with its error', async () => {
    const { stores, failures } = memoryStores();
    const client = stub([]);
    await askDash({ question: 'Anything?', today: '2026-11-05', execute, anthropicApiKey: 'k', client }, stores);
    expect(failures).toHaveLength(1);
    expect(failures[0].calls).toEqual([
      { stop: null, blocks: [], outputTokens: 0, inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, error: 'no reply scripted' },
    ]);
  });

  it('keeps an answer built from progress notes as unfinished, and still keeps the answer', async () => {
    const { stores, failures } = memoryStores();
    const hidden = (thinking: string) => ({ content: [{ type: 'thinking', thinking }], stop_reason: 'end_turn', usage: USAGE });
    const client = stub([hidden('Show the cost under each run.'), hidden('')]);
    const result = await askDash(
      { question: 'Should runs show their cost?', today: '2026-11-05', execute, anthropicApiKey: 'k', client, model: OPUS },
      stores,
    );

    expect(result.error).toBeUndefined();
    expect(result.turns.at(-1)?.body).toContain(NOTES_ONLY);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ outcome: 'unfinished', reason: UNFINISHED_REASON, model: OPUS });
    expect(failures[0].calls.map((c) => [c.stop, c.blocks])).toEqual([
      ['end_turn', ['thinking']],
      ['end_turn', ['thinking']],
    ]);
  });

  it('keeps nothing for an answer that answered', async () => {
    const { stores, failures } = memoryStores();
    const client = stub([
      { content: [{ type: 'tool_use', id: 'a', name: 'answer', input: { answer: 'Yes.', cited: [] } }], stop_reason: 'tool_use', usage: USAGE },
    ]);
    const result = await askDash({ question: 'Anything?', today: '2026-11-05', execute, anthropicApiKey: 'k', client }, stores);
    expect(result.error).toBeUndefined();
    expect(failures).toEqual([]);
  });
});

describe('a failed thread reply is kept', () => {
  it('names the row the thread hangs from', async () => {
    const failures: DashFailure[] = [];
    const dash: ThreadDash = {
      today: '2026-11-05',
      execute,
      apply: async () => ({ ok: false, error: 'no writes' }),
      saveChange: async () => undefined,
      recordFailure: async (failure) => {
        failures.push(failure);
      },
    };
    const result = await replyInThread({
      voice: threadVoice('test-model', 'Dev rules.', 'public.ideas'),
      subject: { ref: 'public.ideas:i1', title: 'An idea' },
      message: 'what next?',
      dash,
      acts: async () => ({ ok: false, error: 'none' }),
      anthropicApiKey: 'k',
      client: stub([{ content: [{ type: 'text', text: 'cut' }], stop_reason: 'max_tokens', usage: USAGE }]),
    });
    expect(result.ok).toBe(false);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ surface: 'thread', outcome: 'failed', model: 'test-model', subjectRef: 'public.ideas:i1' });
    expect(failures[0].calls[0]).toMatchObject({ stop: 'max_tokens', blocks: ['text'] });
  });
});

describe('the row a failure is kept as', () => {
  it('keeps ids only when they are uuids, and the calls in the column names', () => {
    const row = failureRow('u1', {
      surface: 'ask',
      outcome: 'failed',
      reason: '  ',
      model: OPUS,
      conversationId: 'conv-new',
      turnId: '6f1c2c1e-6b0a-4a51-9a3b-1c2d3e4f5a6b',
      calls: [{ stop: 'end_turn', blocks: ['thinking'], outputTokens: 5, inputTokens: 1, cachedInputTokens: 2, cacheWriteTokens: 3 }],
    });
    expect(row).toMatchObject({
      user_id: 'u1',
      reason: 'No reason was given.',
      conversation_id: null,
      turn_id: '6f1c2c1e-6b0a-4a51-9a3b-1c2d3e4f5a6b',
      think: false,
      calls: [{ stop: 'end_turn', blocks: ['thinking'], output_tokens: 5, input_tokens: 1, cached_input_tokens: 2, cache_write_tokens: 3 }],
    });
  });
});

describe('the daily health check raises every kept failure', () => {
  it('writes one alert per failure, naming it, first', () => {
    const health = dashHealth([], [], [], [
      { id: 'f1', surface: 'ask', outcome: 'failed', reason: 'The model reported nothing (stopped: end_turn).', model: OPUS, stops: ['end_turn', null] },
    ]);
    expect(health.failures).toEqual({ count: 1, ids: ['f1'] });
    expect(health.alerts[0]).toBe(
      `Failed ask answer f1 on ${OPUS} (calls: end_turn, threw): The model reported nothing (stopped: end_turn).`,
    );
  });

  it('raises nothing on a day without one', () => {
    expect(dashHealth([], []).alerts).toEqual([]);
  });
});

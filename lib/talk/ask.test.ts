import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { AskToolResult } from '@/lib/ask/db';
import type { SpendReport } from '@/lib/core/spend/pricing';
import {
  answerQuestion,
  askDash,
  ASK_MODEL,
  limitNote,
  MAX_LOOKUPS,
  TIME_BUDGET_MS,
  type AskStores,
} from './ask';
import type { NewTalkTurn, TalkSubject, TalkTurn } from './talk';

/**
 * Dash's question loop, with the model stubbed as a client that plays back a
 * fixed sequence of replies, and the lookups and stores stubbed in memory.
 */

type Sent = {
  model: string;
  tool_choice: { type: string; name?: string };
  tools: { name: string }[];
  system: { text: string }[];
  messages: Anthropic.MessageParam[];
};

const USAGE = { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function use(id: string, name: string, input: unknown) {
  return { type: 'tool_use', id, name, input };
}

function reply(content: unknown[], stop_reason = 'tool_use') {
  return { content, stop_reason, usage: USAGE };
}

/** A client that answers each call with the next reply, or `every` once they run out. */
function stubClient(replies: unknown[], every?: (call: number) => unknown) {
  const sent: Sent[] = [];
  const client = {
    messages: {
      create: async (params: Sent) => {
        // The loop keeps appending to one array; copy what this call saw.
        sent.push(structuredClone(params));
        const next = replies[sent.length - 1] ?? every?.(sent.length);
        if (!next) throw new Error('no reply scripted');
        return next;
      },
    },
  } as unknown as Anthropic;
  return { client, sent };
}

const ORDER = { table: 'public.orders', ref: 'o-1', title: 'eBay order 12', href: '/shopping/orders/o-1' };
const MERCHANT = { table: 'public.merchants', ref: 'm-1', title: 'eBay', href: '/shopping/merchants/m-1' };

function stubExecute(): { execute: (name: string, input: unknown) => Promise<AskToolResult>; calls: [string, unknown][] } {
  const calls: [string, unknown][] = [];
  return {
    calls,
    execute: async (name, input) => {
      calls.push([name, input]);
      if (name === 'search') return { ok: true, rows: [{ ...ORDER, detail: { placed: '2026-09-01' } }] };
      if (name === 'spend_by_merchant') {
        return { ok: true, rows: [MERCHANT], totals: { GBP: 42.5 }, note: 'Cancelled orders left out.' };
      }
      return { ok: false, error: `There is no tool called ${name}.` };
    },
  };
}

/** Stores that keep the conversation in memory. */
function memoryStores(existing: TalkTurn[] = []) {
  const written: { subject: TalkSubject; turns: NewTalkTurn[] }[] = [];
  const spend: SpendReport[] = [];
  let n = 0;
  const stores: AskStores = {
    start: async (question) => ({ kind: 'ask', ref: 'conv-new', title: question }),
    load: async (ref) => (ref === 'conv-old' ? existing : []),
    append: async (subject, turns) => {
      written.push({ subject, turns: [...turns] });
      return turns.map((t) => ({
        id: `t${++n}`,
        role: t.role,
        body: t.body,
        createdAt: `2026-09-27T10:00:0${n}Z`,
        ...(t.toolCalls?.length ? { toolCalls: [...t.toolCalls] } : {}),
        ...(t.citations?.length ? { citations: [...t.citations] } : {}),
      }));
    },
    recordSpend: async (reports) => {
      spend.push(...reports);
    },
  };
  return { stores, written, spend };
}

describe('askDash', () => {
  it('runs a search and a total, stops at the answer, keeps the turns and the spend, and cites only rows the tools returned', async () => {
    const { client, sent } = stubClient([
      reply([use('u1', 'search', { query: 'ebay' })]),
      reply([use('u2', 'spend_by_merchant', { from: '2026-09-01', merchant: 'ebay' })]),
      reply([
        use('u3', 'answer', {
          answer: 'You spent £42.50 at eBay this month, on eBay order 12.',
          cited: [
            { table: 'public.orders', ref: 'o-1' },
            { table: 'public.merchants', ref: 'm-1' },
            { table: 'public.orders', ref: 'o-1' },
            { table: 'public.orders', ref: 'made-up' },
          ],
        }),
      ]),
    ]);
    const { execute, calls } = stubExecute();
    const { stores, written, spend } = memoryStores();

    const result = await askDash(
      { question: 'How much have I spent on eBay this month?', today: '2026-09-27', execute, anthropicApiKey: 'k', client },
      stores,
    );

    // Both lookups ran, with what the model asked for, and then it stopped.
    expect(calls).toEqual([
      ['search', { query: 'ebay' }],
      ['spend_by_merchant', { from: '2026-09-01', merchant: 'ebay' }],
    ]);
    expect(sent).toHaveLength(3);
    expect(sent.every((s) => s.model === ASK_MODEL)).toBe(true);
    expect(sent.every((s) => s.tool_choice.type === 'any')).toBe(true);
    expect(sent[0].system[1].text).toContain('2026-09-27');

    // Each lookup's result went back as the tool_result for its call.
    const second = sent[1].messages;
    const results = second[second.length - 1].content as Anthropic.ToolResultBlockParam[];
    expect(results[0].tool_use_id).toBe('u1');
    expect(JSON.parse(results[0].content as string).rows[0].detail).toEqual({ placed: '2026-09-01' });

    // The question was kept first, then the answer with its working.
    expect(written.map((w) => w.turns.map((t) => t.role))).toEqual([['user'], ['assistant']]);
    expect(written[0].subject).toMatchObject({ kind: 'ask', ref: 'conv-new' });
    const answer = written[1].turns[0];
    expect(answer.citations).toEqual([ORDER, MERCHANT]);
    expect(answer.toolCalls).toEqual([
      { name: 'search', input: { query: 'ebay' }, result: { ok: true, rows: [ORDER] } },
      {
        name: 'spend_by_merchant',
        input: { from: '2026-09-01', merchant: 'ebay' },
        result: { ok: true, rows: [MERCHANT], totals: { GBP: 42.5 }, note: 'Cancelled orders left out.' },
      },
    ]);

    // Three calls, three spend rows.
    expect(spend).toHaveLength(3);
    expect(spend[0]).toMatchObject({ model: ASK_MODEL, usage: { inputTokens: 1000, outputTokens: 100 } });

    expect(result.error).toBeUndefined();
    expect(result.stop).toBe('answered');
    expect(result.conversation).toEqual({ ref: 'conv-new', title: 'How much have I spent on eBay this month?' });
    expect(result.turns.map((t) => t.role)).toEqual(['user', 'assistant']);
    expect(result.turns[1].body).toBe('You spent £42.50 at eBay this month, on eBay order 12.');
  });

  it('answers with what it has when the lookups run out, and says so', async () => {
    const { client, sent } = stubClient([], (call) =>
      sent[call - 1]?.tool_choice.type === 'tool'
        ? reply([use('a', 'answer', { answer: 'Here is what I found.', cited: [{ table: 'public.orders', ref: 'o-1' }] })])
        : reply([use(`u${call}`, 'search', { query: `try ${call}` })]),
    );
    const { execute, calls } = stubExecute();
    const { stores, written, spend } = memoryStores();

    const result = await askDash(
      { question: 'Everything about eBay?', today: '2026-09-27', execute, anthropicApiKey: 'k', client },
      stores,
    );

    expect(calls).toHaveLength(MAX_LOOKUPS);
    expect(sent).toHaveLength(MAX_LOOKUPS + 1);
    expect(sent[MAX_LOOKUPS].tool_choice).toEqual({ type: 'tool', name: 'answer' });
    expect(result.stop).toBe('lookups');
    const body = written[1].turns[0].body;
    expect(body).toBe(`Here is what I found.\n\n${limitNote('lookups')}`);
    expect(body).toContain(`${MAX_LOOKUPS} lookups`);
    expect(written[1].turns[0].citations).toEqual([ORDER]);
    expect(spend).toHaveLength(MAX_LOOKUPS + 1);
  });

  it('refuses lookups past the cap within one round and sends them back as errors', async () => {
    const many = Array.from({ length: MAX_LOOKUPS + 2 }, (_, i) => use(`u${i}`, 'search', { query: `q${i}` }));
    const { client, sent } = stubClient([
      reply(many),
      reply([use('a', 'answer', { answer: 'Partial.', cited: [] })]),
    ]);
    const { execute, calls } = stubExecute();
    const answer = await answerQuestion({
      turns: [{ role: 'user', body: 'q' }],
      today: '2026-09-27',
      execute,
      anthropicApiKey: 'k',
      client,
    });

    expect(calls).toHaveLength(MAX_LOOKUPS);
    const results = sent[1].messages[sent[1].messages.length - 1].content as Anthropic.ToolResultBlockParam[];
    expect(results).toHaveLength(MAX_LOOKUPS + 2);
    expect(results[MAX_LOOKUPS]).toMatchObject({ is_error: true });
    expect(sent[1].tool_choice).toEqual({ type: 'tool', name: 'answer' });
    expect(answer.ok && answer.stop).toBe('lookups');
  });

  it('stops looking when the time budget is spent', async () => {
    let clock = 0;
    const { client, sent } = stubClient([
      reply([use('u1', 'search', { query: 'ebay' })]),
      reply([use('a', 'answer', { answer: 'So far, one order.', cited: [] })]),
    ]);
    const { execute } = stubExecute();
    const answer = await answerQuestion({
      turns: [{ role: 'user', body: 'q' }],
      today: '2026-09-27',
      execute: async (name, input) => {
        clock += TIME_BUDGET_MS;
        return execute(name, input);
      },
      anthropicApiKey: 'k',
      client,
      now: () => clock,
    });

    expect(sent[1].tool_choice).toEqual({ type: 'tool', name: 'answer' });
    expect(answer).toMatchObject({ ok: true, stop: 'time', body: `So far, one order.\n\n${limitNote('time')}` });
  });

  it('answers in prose when told to answer and it looks something up instead', async () => {
    let clock = 0;
    const { client, sent } = stubClient([
      reply([use('u1', 'search', { query: 'interviews' })]),
      reply([use('u2', 'search', { query: 'final round' })]),
      reply([{ type: 'text', text: 'One order, from eBay.' }], 'end_turn'),
    ]);
    const { execute } = stubExecute();
    const answer = await answerQuestion({
      turns: [{ role: 'user', body: 'q' }],
      today: '2026-09-27',
      execute: async (name, input) => {
        clock += TIME_BUDGET_MS;
        return execute(name, input);
      },
      anthropicApiKey: 'k',
      client,
      now: () => clock,
    });

    expect(sent[2].tool_choice).toEqual({ type: 'none' });
    const refused = sent[2].messages.at(-1)?.content as Anthropic.ToolResultBlockParam[];
    expect(refused[0]).toMatchObject({ tool_use_id: 'u2', is_error: true });
    expect(answer).toMatchObject({ ok: true, stop: 'time', body: `One order, from eBay.\n\n${limitNote('time')}` });
  });

  it('sends a failed lookup back as an error result', async () => {
    const { client, sent } = stubClient([
      reply([use('u1', 'nope', {})]),
      reply([use('a', 'answer', { answer: 'I cannot see that.', cited: [] })]),
    ]);
    const { execute } = stubExecute();
    const answer = await answerQuestion({
      turns: [{ role: 'user', body: 'q' }],
      today: '2026-09-27',
      execute,
      anthropicApiKey: 'k',
      client,
    });
    const results = sent[1].messages[sent[1].messages.length - 1].content as Anthropic.ToolResultBlockParam[];
    expect(results[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'u1',
      content: 'There is no tool called nope.',
      is_error: true,
    });
    expect(answer).toMatchObject({ ok: true, body: 'I cannot see that.', citations: [] });
  });

  it('continues a past conversation, sending what it said and cited before', async () => {
    const earlier: TalkTurn[] = [
      { id: 'a', role: 'user', body: 'What did I buy on eBay?', createdAt: '2026-09-26T10:00:00Z' },
      {
        id: 'b',
        role: 'assistant',
        body: 'eBay order 12.',
        createdAt: '2026-09-26T10:00:05Z',
        citations: [ORDER],
      },
    ];
    const { client, sent } = stubClient([
      reply([use('a', 'answer', { answer: 'It was placed on 1 September.', cited: [{ table: 'public.orders', ref: 'o-1' }] })]),
    ]);
    const { execute } = stubExecute();
    const { stores, written } = memoryStores(earlier);

    const result = await askDash(
      { question: 'When was it?', conversationRef: 'conv-old', today: '2026-09-27', execute, anthropicApiKey: 'k', client },
      stores,
    );

    expect(sent[0].messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(sent[0].messages[1].content).toContain('public.orders o-1 "eBay order 12"');
    expect(sent[0].messages[2].content).toBe('When was it?');
    expect(written.every((w) => w.subject.ref === 'conv-old')).toBe(true);
    // A row an earlier answer cited may be cited again without a new lookup.
    expect(written[1].turns[0].citations).toEqual([ORDER]);
    expect(result.conversation?.ref).toBe('conv-old');
  });

  it('refuses a conversation that is not there', async () => {
    const { stores, written } = memoryStores();
    const result = await askDash(
      { question: 'And?', conversationRef: 'someone-elses', today: '2026-09-27', execute: stubExecute().execute, anthropicApiKey: 'k' },
      stores,
    );
    expect(result.error).toBe('That conversation is not there any more.');
    expect(written).toEqual([]);
  });

  it('keeps the question and records the spend when the answer fails', async () => {
    const { client } = stubClient([reply([{ type: 'text', text: 'Hmm' }], 'max_tokens')]);
    const { stores, written, spend } = memoryStores();
    const result = await askDash(
      { question: 'Anything?', today: '2026-09-27', execute: stubExecute().execute, anthropicApiKey: 'k', client },
      stores,
    );
    expect(written).toHaveLength(1);
    expect(spend).toHaveLength(1);
    expect(result.turns.map((t) => t.role)).toEqual(['user']);
    expect(result.error).toMatch(/^Dash could not answer: The reply was cut off/);
  });

  it('keeps the question and says so when there is no API key', async () => {
    const { stores, written } = memoryStores();
    const result = await askDash(
      { question: 'Anything?', today: '2026-09-27', execute: stubExecute().execute, anthropicApiKey: undefined },
      stores,
    );
    expect(written).toHaveLength(1);
    expect(result.error).toContain('ANTHROPIC_API_KEY');
  });
});

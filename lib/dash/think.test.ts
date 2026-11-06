import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { AskToolResult } from '@/lib/ask/db';
import { OPUS, SONNET } from '@/lib/core/models';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { parseAskInput } from '@/lib/talk/ask-input';
import { isShownLookup, lookupLabel } from '@/lib/talk/lookups';
import { MAX_MOCKUP_HTML, mockupDocument, parseMockup, turnMockups } from '@/lib/talk/mockup';
import type { NewTalkTurn, TalkSubject } from '@/lib/talk/talk';
import { SESSION_SENT_BODY, THINK_FALLBACK, sessionSentState, turnSessionSent, turnThought } from '@/lib/talk/thought';
import { chatAsMessage } from '@/lib/talk/chat-to-session';
import { answerQuestion, askDash, ASK_VOICE, thinkVoice, type AskStores } from './ask';
import { MAX_WEB_SEARCHES } from './web-search';
import { THINK_EFFORT, THINK_MODEL, THINK_RULES, THINK_TIME_BUDGET_MS, thoughtCost, type ThinkDeps } from './think';
import { cleanPath, MAX_CODE_CHARS, readCode, searchCode } from './think-code';

/** Ask's "Think it through" (plan #2789.10), with the model and GitHub stubbed. */

type Sent = {
  model: string;
  output_config?: { effort?: string };
  tools: { name: string; type?: string }[];
  system: { text: string }[];
  messages: Anthropic.MessageParam[];
};

const USAGE = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function use(id: string, name: string, input: unknown) {
  return { type: 'tool_use', id, name, input };
}

function stubClient(replies: unknown[]) {
  const sent: Sent[] = [];
  const create = async (params: Sent) => {
    sent.push(structuredClone(params));
    const next = replies[sent.length - 1];
    if (!next) throw new Error('no reply scripted');
    return next;
  };
  // Think's max_tokens is large, so the loop streams it (no one is shown the text here).
  const client = {
    messages: {
      create,
      stream: (params: Sent) => ({ on: () => undefined, finalMessage: () => create(params) }),
    },
  } as unknown as Anthropic;
  return { client, sent };
}

/** GitHub's contents and search endpoints, answering from a map of paths. */
function fakeGitHub(files: Record<string, string>) {
  const asked: string[] = [];
  const fetch = (async (url: string) => {
    asked.push(url);
    const contents = /\/contents\/([^?]*)\?ref=main$/.exec(url);
    if (contents) {
      const path = decodeURIComponent(contents[1]);
      if (path in files) {
        return new Response(
          JSON.stringify({ type: 'file', path, size: files[path].length, encoding: 'base64', content: Buffer.from(files[path]).toString('base64') }),
        );
      }
      const inside = Object.keys(files).filter((p) => p.startsWith(`${path}/`));
      if (inside.length > 0) {
        return new Response(JSON.stringify(inside.map((p) => ({ type: 'file', path: p, name: p.split('/').pop() }))));
      }
      return new Response('{}', { status: 404 });
    }
    if (url.includes('/search/code?')) {
      return new Response(JSON.stringify({ total_count: 1, items: [{ path: Object.keys(files)[0] }] }));
    }
    return new Response('{}', { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, asked };
}

const REPO = { owner: 'someone', repo: 'dashboard', branch: 'main' };

function deps(files: Record<string, string>, owner = true): ThinkDeps & { asked: string[] } {
  const github = fakeGitHub(files);
  return {
    token: 'token',
    repo: REPO,
    fetch: github.fetch,
    asked: github.asked,
    codeAccess: async () => (owner ? { ok: true } : { ok: false, error: 'Dev belongs to the owner of this app.' }),
  };
}

const noLookups = async (): Promise<AskToolResult> => ({ ok: true, rows: [] });

describe('thinkVoice', () => {
  it('answers on Opus at high effort, with web search, the code lookups and the mockup on top of Ask', () => {
    const voice = thinkVoice(null);
    expect(voice.model).toBe(OPUS);
    expect(voice.effort).toBe('high');
    expect(voice.timeBudgetMs).toBe(THINK_TIME_BUDGET_MS);
    expect(voice.serverTools?.map((tool) => (tool as { type: string }).type)).toEqual(['web_search_20260209']);
    const names = voice.tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['read_spec', 'read_code', 'search_code', 'show_mockup']));
    expect(names.length).toBe(ASK_VOICE.tools.length + 3);
    expect(voice.system.startsWith(ASK_VOICE.system)).toBe(true);
    expect(voice.system.endsWith(THINK_RULES)).toBe(true);
  });

  it('keeps a scoped question to its workspace, as Ask does', () => {
    const names = thinkVoice('shopping').tools.map((tool) => tool.name);
    expect(names).not.toContain('read_spec');
    expect(names).toContain('read_code');
  });
});

describe('answerQuestion with Think it through', () => {
  it('sends Opus with effort high and web search, reads a spec and a file, and keeps a mockup', async () => {
    const { client, sent } = stubClient([
      {
        content: [
          use('u1', 'read_spec', { spec: 'one-interface' }),
          use('u2', 'read_code', { path: 'components/talk/model-chip.tsx' }),
        ],
        stop_reason: 'tool_use',
        usage: USAGE,
      },
      {
        content: [use('u3', 'show_mockup', { title: 'The box foot', html: '<div style="padding:8px">Think it through</div>' })],
        stop_reason: 'tool_use',
        usage: USAGE,
      },
      {
        content: [use('u4', 'answer', { answer: 'Keep the chip in the foot.', cited: [] })],
        stop_reason: 'tool_use',
        usage: USAGE,
      },
    ]);
    const looked: string[] = [];
    const think = deps({ 'components/talk/model-chip.tsx': 'export function ModelChip() {}' });
    const answer = await answerQuestion({
      turns: [{ role: 'user', body: 'Should the model chip stay in the box?' }],
      today: '2026-11-04',
      execute: async (name) => {
        looked.push(name);
        return { ok: true, rows: [], note: 'The one-interface spec.' };
      },
      anthropicApiKey: 'test',
      client,
      think,
    });

    expect(answer.ok && answer.body).toBe('Keep the chip in the foot.');
    expect(sent[0].model).toBe(OPUS);
    expect(sent[0].output_config).toEqual({ effort: 'high' });
    expect(sent[0].tools.some((tool) => tool.type === 'web_search_20260209')).toBe(true);
    // The spec is one of Ask's own lookups; the file goes to GitHub.
    expect(looked).toEqual(['read_spec']);
    expect(think.asked[0]).toBe(
      'https://api.github.com/repos/someone/dashboard/contents/components/talk/model-chip.tsx?ref=main',
    );
    const file = JSON.stringify(sent[1].messages.at(-1));
    expect(file).toContain('export function ModelChip');
    // The mockup is kept with the answer's calls, and the file's text is not.
    expect(answer.ok && turnMockups(answer.toolCalls)).toEqual([
      { title: 'The box foot', html: '<div style="padding:8px">Think it through</div>', height: 360 },
    ]);
    expect(JSON.stringify(answer.ok && answer.toolCalls)).not.toContain('export function ModelChip');
  });

  it('refuses the code to an account that is not the owner', async () => {
    const { client, sent } = stubClient([
      { content: [use('u1', 'read_code', { path: 'lib/a.ts' })], stop_reason: 'tool_use', usage: USAGE },
      { content: [use('u2', 'answer', { answer: 'I could not read the code.', cited: [] })], stop_reason: 'tool_use', usage: USAGE },
    ]);
    const think = deps({ 'lib/a.ts': 'x' }, false);
    await answerQuestion({
      turns: [{ role: 'user', body: 'How is a built?' }],
      today: '2026-11-04',
      execute: noLookups,
      anthropicApiKey: 'test',
      client,
      think,
    });
    expect(think.asked).toEqual([]);
    expect(JSON.stringify(sent[1].messages.at(-1))).toContain('Dev belongs to the owner');
  });

  it('with the switch off, asks as before: the chosen model, no effort, Ask\'s own web search, no think tools', async () => {
    const { client, sent } = stubClient([
      { content: [use('u1', 'answer', { answer: 'Sonnet.', cited: [] })], stop_reason: 'tool_use', usage: USAGE },
    ]);
    await answerQuestion({
      turns: [{ role: 'user', body: 'Which model?' }],
      today: '2026-11-04',
      execute: noLookups,
      anthropicApiKey: 'test',
      client,
    });
    expect(sent[0].model).toBe(SONNET);
    expect(sent[0].output_config).toBeUndefined();
    const names = sent[0].tools.map((tool) => tool.name);
    // Ask's own search, capped lower than thinking's (plan #2861).
    expect(sent[0].tools.find((tool) => tool.name === 'web_search')).toMatchObject({ max_uses: MAX_WEB_SEARCHES });
    expect(names).not.toContain('read_code');
    expect(names).not.toContain('show_mockup');
    expect(sent[0].system[0].text).not.toContain(THINK_RULES);
  });
});

function memoryStores() {
  const written: NewTalkTurn[] = [];
  const spend: SpendReport[] = [];
  let n = 0;
  const stores: AskStores = {
    start: async (question) => ({ kind: 'ask', ref: 'conv-new', title: question }),
    load: async () => [],
    append: async (_subject: TalkSubject, turns) => {
      written.push(...turns);
      return turns.map((t) => ({
        id: `t${++n}`,
        role: t.role,
        body: t.body,
        createdAt: '2026-11-04T10:00:00Z',
        ...(t.toolCalls?.length ? { toolCalls: [...t.toolCalls] } : {}),
      }));
    },
    recordSpend: async (reports) => {
      spend.push(...reports);
    },
    saveProposal: async () => {
      throw new Error('no proposals here');
    },
    attachProposals: async () => {},
    discardProposals: async () => {},
  };
  return { stores, written, spend };
}

describe('askDash with Think it through', () => {
  it('keeps the answer with its mark and what it cost', async () => {
    const { client } = stubClient([
      { content: [use('u1', 'answer', { answer: 'Take the offer.', cited: [] })], stop_reason: 'tool_use', usage: USAGE },
    ]);
    const { stores, spend } = memoryStores();
    const result = await askDash(
      {
        question: 'Should I take the offer?',
        today: '2026-11-04',
        execute: noLookups,
        anthropicApiKey: 'test',
        client,
        think: deps({}),
      },
      stores,
    );
    const answer = result.turns.find((turn) => turn.role === 'assistant');
    const thought = turnThought(answer?.toolCalls);
    expect(thought).toEqual({ model: THINK_MODEL, effort: THINK_EFFORT, costMicros: thoughtCost(spend), fallback: null });
    // 1000 input at $4 and 500 output at $20 a million: $0.014.
    expect(thought?.costMicros).toBe(14_000);
  });

  it('keeps an ordinary answer with no mark', async () => {
    const { client } = stubClient([
      { content: [use('u1', 'answer', { answer: 'Yes.', cited: [] })], stop_reason: 'tool_use', usage: USAGE },
    ]);
    const { stores } = memoryStores();
    const result = await askDash(
      { question: 'Any todos?', today: '2026-11-04', execute: noLookups, anthropicApiKey: 'test', client },
      stores,
    );
    expect(turnThought(result.turns.find((turn) => turn.role === 'assistant')?.toolCalls)).toBeNull();
  });
});

describe('askDash with Think it through, in a session thread (plan #2789.11)', () => {
  const THREAD = '11111111-2222-4333-8444-555555555555';
  const QUESTION = 'Should the vault sync through a repository?';

  it('sends the chat to a session instead of asking the model, and says so at once with the thread', async () => {
    const { client, sent } = stubClient([]);
    const { stores, written } = memoryStores();
    const handed: string[] = [];
    const result = await askDash(
      { question: QUESTION, today: '2026-11-05', execute: noLookups, anthropicApiKey: 'test', client, think: deps({}) },
      {
        ...stores,
        toSession: async (conversation) => {
          handed.push(chatAsMessage(conversation, { think: true }));
          return { ok: true, threadId: THREAD };
        },
      },
    );
    expect(sent).toHaveLength(0);
    expect(handed[0]).toContain('Please think my last question through');
    expect(handed[0]).toContain(`Me: ${QUESTION}`);
    const reply = result.turns.find((turn) => turn.role === 'assistant');
    expect(reply?.body).toBe(SESSION_SENT_BODY);
    expect(turnSessionSent(reply?.toolCalls)).toEqual({ threadId: THREAD });
    expect(turnThought(reply?.toolCalls)).toBeNull();
    expect(written.map((t) => t.role)).toEqual(['user', 'assistant']);
    expect(result.error).toBeUndefined();
  });

  it('answers here when the thread could not be started, and the mark says why', async () => {
    const { client } = stubClient([
      { content: [use('u1', 'answer', { answer: 'Keep the plugin.', cited: [] })], stop_reason: 'tool_use', usage: USAGE },
    ]);
    const { stores } = memoryStores();
    const result = await askDash(
      { question: QUESTION, today: '2026-11-05', execute: noLookups, anthropicApiKey: 'test', client, think: deps({}) },
      { ...stores, toSession: async () => ({ ok: false, error: 'insert failed' }) },
    );
    const answer = result.turns.find((turn) => turn.role === 'assistant');
    expect(answer?.body).toContain('Keep the plugin.');
    expect(turnThought(answer?.toolCalls)?.fallback).toBe(THINK_FALLBACK.notStarted);
    expect(turnSessionSent(answer?.toolCalls)).toBeNull();
  });

  it('with no broker, answers here and keeps the reason it was given', async () => {
    const { client } = stubClient([
      { content: [use('u1', 'answer', { answer: 'Keep the plugin.', cited: [] })], stop_reason: 'tool_use', usage: USAGE },
    ]);
    const { stores } = memoryStores();
    const result = await askDash(
      {
        question: QUESTION,
        today: '2026-11-05',
        execute: noLookups,
        anthropicApiKey: 'test',
        client,
        think: deps({}),
        thinkFallback: THINK_FALLBACK.noBroker,
      },
      stores,
    );
    expect(turnThought(result.turns.find((turn) => turn.role === 'assistant')?.toolCalls)?.fallback).toBe(THINK_FALLBACK.noBroker);
  });

  it('never sends an ordinary question to a session', async () => {
    const { client } = stubClient([
      { content: [use('u1', 'answer', { answer: 'Yes.', cited: [] })], stop_reason: 'tool_use', usage: USAGE },
    ]);
    const { stores } = memoryStores();
    let called = false;
    await askDash(
      { question: 'Any todos?', today: '2026-11-05', execute: noLookups, anthropicApiKey: 'test', client },
      {
        ...stores,
        toSession: async () => {
          called = true;
          return { ok: true, threadId: THREAD };
        },
      },
    );
    expect(called).toBe(false);
  });

  it('reads where the session has got to: waiting, its newest line, a question back, then its answer', () => {
    const status = { author: 'session' as const, kind: 'status' as const, answer: null };
    expect(sessionSentState([], null)).toEqual({ state: 'waiting' });
    expect(sessionSentState([status], 'Reading the vault spec')).toEqual({ state: 'working', line: 'Reading the vault spec' });
    expect(sessionSentState([status, { author: 'session', kind: 'question', answer: null }], 'x')).toEqual({ state: 'asked' });
    expect(sessionSentState([{ author: 'session', kind: 'text', answer: null }], 'x')).toEqual({ state: 'answered' });
    // The person's own first message is not the session answering.
    expect(sessionSentState([{ author: 'person', kind: 'text', answer: null }], null)).toEqual({ state: 'waiting' });
  });
});

describe('thoughtCost', () => {
  it('is null with nothing reported, or with a call it cannot price', () => {
    expect(thoughtCost([])).toBeNull();
    expect(
      thoughtCost([{ model: 'not-a-model', usage: { inputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 1 } }]),
    ).toBeNull();
  });
});

describe('the code lookups', () => {
  it('reads a file from main, and cuts a long one', async () => {
    const long = 'a'.repeat(MAX_CODE_CHARS + 10);
    const d = deps({ 'lib/short.ts': 'short', 'lib/long.ts': long });
    const short = await readCode({ path: './lib/short.ts' }, d);
    expect(short.ok && short.found).toEqual([{ path: 'lib/short.ts', text: 'short' }]);
    const cut = await readCode({ path: 'lib/long.ts' }, d);
    expect(cut.ok && (cut.found?.[0] as { text: string }).text.length).toBe(MAX_CODE_CHARS);
    expect(cut.ok && cut.note).toContain('first 30000');
  });

  it('lists a folder', async () => {
    const result = await readCode({ path: 'lib' }, deps({ 'lib/a.ts': 'a', 'lib/b.ts': 'b' }));
    expect(result.ok && result.found).toEqual([
      { path: 'lib/a.ts', kind: 'file' },
      { path: 'lib/b.ts', kind: 'file' },
    ]);
  });

  it('says what went wrong for a missing path, and refuses one that climbs out', async () => {
    const missing = await readCode({ path: 'lib/none.ts' }, deps({}));
    expect(!missing.ok && missing.error).toContain('lib/none.ts could not be read');
    expect(cleanPath('../secrets')).toBeNull();
    expect(cleanPath('lib/../x')).toBeNull();
    expect(cleanPath('/lib/a.ts/')).toBe('lib/a.ts');
  });

  it('searches the repository and names the files', async () => {
    const d = deps({ 'lib/dash/ask.ts': 'askDash' });
    const result = await searchCode({ query: 'askDash' }, d);
    expect(result.ok && result.found).toEqual([{ path: 'lib/dash/ask.ts' }]);
    expect(decodeURIComponent(d.asked[0])).toContain('askDash repo:someone/dashboard');
  });

  it('says so when the deployment has no token', async () => {
    const result = await readCode({ path: 'lib/a.ts' }, { token: null });
    expect(!result.ok && result.error).toContain('GITHUB_READ_TOKEN');
  });
});

describe('mockups', () => {
  it('takes a title and HTML, and refuses scripts and anything too long', () => {
    expect(parseMockup({ title: ' A  box ', html: '<p>x</p>' })).toEqual({
      ok: true,
      mockup: { title: 'A box', html: '<p>x</p>', height: 360 },
    });
    expect(parseMockup({ title: 'A', html: '<p>x</p>', height: 5000 }).ok && parseMockup({ title: 'A', html: '<p>x</p>', height: 5000 })).toMatchObject({
      mockup: { height: 720 },
    });
    expect(parseMockup({ title: 'A', html: '<script>alert(1)</script>' }).ok).toBe(false);
    expect(parseMockup({ title: 'A', html: 'x'.repeat(MAX_MOCKUP_HTML + 1) }).ok).toBe(false);
    expect(parseMockup({ html: '<p>x</p>' }).ok).toBe(false);
  });

  it('draws in a document that refuses every fetch', () => {
    const doc = mockupDocument({ title: 'A', html: '<p>x</p>', height: 200 });
    expect(doc.indexOf("default-src 'none'")).toBeLessThan(doc.indexOf('<p>x</p>'));
  });

  it('is not listed with the lookups, and nor is the mark; the code reads are', () => {
    expect(isShownLookup('show_mockup')).toBe(false);
    expect(isShownLookup('think_it_through')).toBe(false);
    expect(isShownLookup('read_code')).toBe(true);
    expect(lookupLabel('read_code', { path: 'lib/a.ts' })).toBe('Reading “lib/a.ts” in the code');
  });
});

describe('parseAskInput', () => {
  it('reads think only when it is exactly true', () => {
    const on = parseAskInput('Q', null, null, undefined, undefined, undefined, undefined, undefined, true);
    const off = parseAskInput('Q', null, null, undefined, undefined, undefined, undefined, undefined, 'yes');
    expect(on.ok && on.input.think).toBe(true);
    expect(off.ok && off.input.think).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import {
  assembleChatContext,
  CHAT_CONTEXT_BUDGET,
  chatPrompt,
  cutToTokens,
  estimateTokens,
  LAYER_BUDGETS,
  LAYER_NAMES,
  loadChatContext,
  MESSAGE_TOKENS_MAX,
  rankGoals,
  recallQuery,
  refersBack,
  type ChatContext,
  type ChatContextInput,
  type ContextMessage,
} from './chat-context';

/**
 * A stand-in for PostgREST over in-memory tables, with the filters the loader
 * uses: eq, is, not-is-null, lt, or (pinned/due_on), order, limit and a
 * websearch text search that matches any of its `or` words.
 */
type Row = Record<string, unknown>;
function fakeClient(tables: Record<string, Row[]>, reads: string[] = []) {
  const from = (schema: string) => (table: string) => {
    const name = `${schema}.${table}`;
    reads.push(name);
    let list = [...(tables[name] ?? [])];
    let limit = Infinity;
    const chain = {
      select: () => chain,
      eq: (col: string, value: unknown) => ((list = list.filter((r) => r[col] === value)), chain),
      is: (col: string, value: null) => ((list = list.filter((r) => (r[col] ?? null) === value)), chain),
      // Only `.not(col, 'is', null)` is used.
      not: (col: string) => ((list = list.filter((r) => r[col] != null)), chain),
      lt: (col: string, value: string) => ((list = list.filter((r) => String(r[col]) < value)), chain),
      or: (expr: string) => {
        const due = /due_on\.lte\.(\S+)/.exec(expr)?.[1] ?? '';
        list = list.filter((r) => r.pinned === true || (typeof r.due_on === 'string' && r.due_on <= due));
        return chain;
      },
      textSearch: (col: string, query: string) => {
        expect(col).toBe('search');
        const words = query.split(' or ');
        list = list.filter((r) => words.some((w) => String(r.text).toLowerCase().includes(w)));
        return chain;
      },
      order: (col: string, opts: { ascending: boolean }) => {
        list.sort((a, b) => String(a[col] ?? '').localeCompare(String(b[col] ?? '')) * (opts.ascending ? 1 : -1));
        return chain;
      },
      limit: (n: number) => ((limit = n), chain),
      maybeSingle: async () => ({ data: list[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: list.slice(0, limit), error: null }),
    };
    return chain;
  };
  const client = { from: from('you'), schema: (s: string) => ({ from: from(s) }) };
  return client as unknown as YouSupabaseClient;
}

const USER = 'u1';
const OTHER = 'u2';
const CHAT = 'c1';
const ADVISOR = 'a1';
const NOW = new Date('2026-11-03T15:00:00Z');
const TZ = 'Europe/London';

const brain = {
  version: 2,
  assessment: { name: 'Months of runway', text: 'How many months they can last.' },
  evidence: ['Last month of spending'],
  questions: ['What did last month come to?', 'What does a month of waiting cost?', 'Which offer could you turn down?'],
  rules: Array.from({ length: 8 }, (_, i) => `Rule ${i}: ${'keep six weeks of cash '.repeat(12)}(Source ${i})`),
  frameworks: [{ name: 'Runway', text: 'Months of cash at last month’s burn.' }],
  positions: [{ topic: 'Waiting', text: 'Waiting has a monthly price.' }],
  contrarian: [],
  disagreements: [],
  stories: [],
  never: ['Never says money does not matter.'],
  voice: 'Short sentences with a number in most of them.',
  sources: Array.from({ length: 10 }, (_, i) => ({ label: `S${i}`, link: `https://example.com/${i}` })),
};

const iso = (ms: number) => new Date(ms).toISOString();
const words = ['runway', 'offer', 'interview', 'budget', 'apartment', 'piano', 'garden', 'novel', 'travel', 'savings'];

/** A thread of `count` messages, one every 40 minutes, alternating sides, ending just before NOW. */
function thread(count: number): Row[] {
  const step = 40 * 60 * 1000;
  const start = NOW.getTime() - count * step;
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    user_id: USER,
    chat_id: CHAT,
    role: i % 2 === 0 ? 'person' : 'advisor',
    kind: 'reply',
    // Every 97th message is a long paste; the rest are ordinary texts about one of the words.
    text: i % 97 === 0 ? `Pasted: ${'a long essay about the ' + words[i % 10] + ' '.repeat(1)}`.repeat(400) : `Message ${i} about the ${words[i % 10]} and how it went.`,
    created_at: iso(start + i * step),
  }));
}

/** Episodes over that thread, every 12 messages, each summarised at length. */
function episodesOf(messages: Row[]): Row[] {
  const out: Row[] = [];
  for (let i = 0; i < messages.length; i += 12) {
    const slice = messages.slice(i, i + 12);
    out.push({
      id: `e${i}`,
      user_id: USER,
      chat_id: CHAT,
      started_at: slice[0].created_at,
      ended_at: slice[slice.length - 1].created_at,
      message_count: slice.length,
      summary: i + 12 >= messages.length ? null : `They talked about ${words[i % 10]}. ${'More of what was said. '.repeat(60)}`,
    });
  }
  return out;
}

function bigTables(count = 5_000): Record<string, Row[]> {
  const messages = thread(count);
  return {
    'you.advisor_chats': [
      { id: CHAT, user_id: USER, advisor_id: ADVISOR },
      { id: 'c2', user_id: OTHER, advisor_id: 'a2' },
    ],
    'you.board_advisors': [
      {
        id: ADVISOR,
        user_id: USER,
        key: 'cfo',
        name: 'CFO',
        kind: 'seat',
        question: 'What does this cost, and can you afford it?',
        focus: 'Six to twelve months: spending, runway and income.',
        persona: `Who you are: the CFO. ${'You read the spending first. '.repeat(40)}`,
        brain,
        made_by_you: false,
      },
    ],
    'you.advisor_memory': [
      ...Array.from({ length: 300 }, (_, i) => ({
        id: `mem${i}`,
        user_id: USER,
        advisor_id: ADVISOR,
        kind: ['fact', 'preference', 'commitment', 'open_thread'][i % 4],
        text: `Memory ${i}: ${'something they told you once. '.repeat(8)}`,
        due_on: i % 4 === 2 ? '2026-11-0' + ((i % 9) + 1) : null,
        done_at: null,
        created_at: iso(NOW.getTime() - i * 3_600_000),
        retired_at: i % 10 === 0 ? iso(NOW.getTime()) : null,
      })),
      { id: 'other-mem', user_id: OTHER, advisor_id: ADVISOR, kind: 'fact', text: 'Not theirs.', created_at: iso(NOW.getTime()), retired_at: null },
    ],
    'you.advisor_messages': [...messages, { id: 'other', user_id: OTHER, chat_id: CHAT, role: 'person', kind: 'reply', text: 'not theirs', created_at: iso(NOW.getTime()) }],
    'you.advisor_episodes': episodesOf(messages),
    'you.places': [
      { user_id: USER, name: 'Flat', city: 'London', country: 'United Kingdom', moved_in: '2024-01-01', moved_out: null },
      { user_id: USER, name: 'Old flat', city: 'Leeds', country: 'United Kingdom', moved_in: '2020-01-01', moved_out: '2023-12-31' },
    ],
    'you.now': [{ user_id: USER, body: 'Job hunting, and learning the piano at night.' }],
    'todo.tasks': [
      { user_id: USER, title: 'Pay rent', status: 'open', due_on: '2026-11-03', pinned: false, snoozed_until: null },
      { user_id: USER, title: 'Call the bank', status: 'open', due_on: '2026-10-30', pinned: false, snoozed_until: null },
      { user_id: USER, title: 'Someday', status: 'open', due_on: '2026-12-30', pinned: false, snoozed_until: null },
      { user_id: USER, title: 'Snoozed', status: 'open', due_on: '2026-11-01', pinned: false, snoozed_until: '2026-11-10T00:00:00Z' },
      { user_id: OTHER, title: 'Not theirs', status: 'open', due_on: '2026-11-01', pinned: true, snoozed_until: null },
    ],
    'goals.items': [
      { id: 'g1', user_id: USER, level: 'goal', status: 'open', title: 'Six months of savings', detail: null, due_on: '2027-06-01', area_id: 'ar1', archived_at: null, closed_at: null },
      { id: 'g2', user_id: USER, level: 'goal', status: 'open', title: 'Play a Chopin nocturne', detail: null, due_on: null, area_id: 'ar2', archived_at: null, closed_at: null },
    ],
    'goals.areas': [
      { id: 'ar1', user_id: USER, name: 'Money' },
      { id: 'ar2', user_id: USER, name: 'Music' },
    ],
  };
}

function expectUnderBudget(ctx: ChatContext) {
  for (const name of LAYER_NAMES) {
    expect(ctx.layers[name].tokens, name).toBeLessThanOrEqual(LAYER_BUDGETS[name]);
  }
  expect(ctx.tokens).toBeLessThanOrEqual(CHAT_CONTEXT_BUDGET);
  expect(ctx.budget).toBe(CHAT_CONTEXT_BUDGET);
}

describe('budgets', () => {
  it('sum to about fourteen thousand tokens', () => {
    expect(CHAT_CONTEXT_BUDGET).toBe(14_000);
  });

  it('cut long text at a word, under the ceiling', () => {
    const text = 'word '.repeat(5_000);
    const cut = cutToTokens(text, 100);
    expect(estimateTokens(cut)).toBeLessThanOrEqual(100);
    expect(cut.endsWith('word…')).toBe(true);
    expect(cutToTokens('short', 100)).toBe('short');
  });
});

describe('a reply on a 5,000-message thread', () => {
  it('stays under every budget, with every layer filled', async () => {
    const reads: string[] = [];
    const client = fakeClient(bigTables(), reads);
    const ctx = await loadChatContext(client, USER, CHAT, {
      now: NOW,
      timeZone: TZ,
      message: 'Remember what you said about the runway and the savings plan?',
    });
    expectUnderBudget(ctx);
    for (const name of LAYER_NAMES) expect(ctx.layers[name].text, name).not.toBe('');
    // The budgets, not the reads, decided what was left out.
    expect(ctx.layers.memory.dropped).toBeGreaterThan(0);
    expect(ctx.layers.episodes.dropped).toBeGreaterThan(0);
    // The newest messages are kept word for word, newest last.
    expect(ctx.messages[ctx.messages.length - 1].id).toBe('m4999');
    expect(ctx.messages.length).toBeGreaterThan(20);
    for (const m of ctx.messages) expect(estimateTokens(m.text)).toBeLessThanOrEqual(MESSAGE_TOKENS_MAX);
    // Recall finds older messages about the runway, none from the recent window.
    expect(ctx.layers.recall.kept).toBe(5);
    expect(ctx.layers.recall.text).toContain('runway');
    // Live rows: place, Now, today's and overdue todos (not snoozed, not later, not another account's), the savings goal.
    const live = ctx.layers.live.text;
    expect(live).toContain('Where they live: London, United Kingdom.');
    expect(live).toContain('learning the piano');
    expect(live).toContain('Pay rent (due today)');
    expect(live).toContain('Call the bank (overdue since 2026-10-30)');
    expect(live).not.toContain('Someday');
    expect(live).not.toContain('Snoozed');
    expect(live).not.toContain('Not theirs');
    expect(live).toContain('Six months of savings (Money, due 2027-06-01)');
    // No other account's rows.
    expect(ctx.layers.memory.text).not.toContain('Not theirs');
    expect(ctx.messages.some((m) => m.id === 'other')).toBe(false);
    // Reads are bounded: one each, with the recall the only second read of the thread.
    expect(reads.filter((r) => r === 'you.advisor_messages')).toHaveLength(2);
  });

  it('stays under budget for every mentor shape: no persona, no brain, a persona at its 8,000-character limit', () => {
    const base = assembleInput();
    const cases: ChatContextInput['mentor'][] = [
      { ...base.mentor, persona: null },
      { ...base.mentor, persona: null, brain: null },
      { ...base.mentor, persona: 'x '.repeat(4_000) },
    ];
    for (const mentor of cases) {
      const ctx = assembleChatContext({ ...base, mentor }, null);
      expectUnderBudget(ctx);
      expect(ctx.layers.persona.text).toContain(`You are the ${mentor.name}`);
    }
  });

  it('reads no recall when the message does not refer back', async () => {
    const reads: string[] = [];
    const ctx = await loadChatContext(fakeClient(bigTables(), reads), USER, CHAT, { now: NOW, timeZone: TZ, message: 'Should I take the offer?' });
    expect(ctx.layers.recall.text).toBe('');
    expect(reads.filter((r) => r === 'you.advisor_messages')).toHaveLength(1);
    expectUnderBudget(ctx);
  });

  it('answers the newest message of the person when none is passed', async () => {
    const ctx = await loadChatContext(fakeClient(bigTables(41)), USER, CHAT, { now: NOW, timeZone: TZ });
    // 41 messages: the window holds 40, and an episode before it is open (no summary yet).
    expectUnderBudget(ctx);
    expect(ctx.messages[0].id).toBe('m1');
  });

  it('refuses a chat that is not the person\'s', async () => {
    await expect(loadChatContext(fakeClient(bigTables(10)), USER, 'c2', { now: NOW, timeZone: TZ })).rejects.toThrow('not found');
  });
});

function msg(i: number, role: 'person' | 'advisor', text: string, at: string): ContextMessage {
  return { id: `m${i}`, role, kind: 'reply', text, createdAt: at };
}

function assembleInput(): ChatContextInput {
  return {
    mentor: {
      id: ADVISOR,
      key: 'cfo',
      name: 'CFO',
      kind: 'seat',
      question: 'What does this cost?',
      focus: 'Money.',
      persona: 'Who you are: the CFO.',
      brain,
      madeByYou: false,
    },
    memory: [
      { id: 'f', kind: 'fact', text: 'They rent in London.', dueOn: null, doneAt: null, createdAt: '2026-10-01T00:00:00Z' },
      { id: 'd', kind: 'commitment', text: 'Cancel the gym.', dueOn: '2026-10-01', doneAt: '2026-10-02T00:00:00Z', createdAt: '2026-09-01T00:00:00Z' },
      { id: 'c', kind: 'commitment', text: 'Send the budget.', dueOn: '2026-11-07', doneAt: null, createdAt: '2026-11-01T00:00:00Z' },
      { id: 'o', kind: 'open_thread', text: 'Whether to move.', dueOn: null, doneAt: null, createdAt: '2026-10-05T00:00:00Z' },
    ],
    episodes: [],
    recall: [],
    recent: [
      msg(1, 'advisor', 'Morning. Rent went out yesterday.', '2026-11-02T08:00:00Z'),
      msg(2, 'person', 'Thanks.', '2026-11-03T14:00:00Z'),
      msg(3, 'person', 'What about the offer?', '2026-11-03T14:01:00Z'),
    ],
    live: { now: NOW, timeZone: TZ, place: null, nowNote: null, todos: [], goals: [] },
  };
}

describe('layers', () => {
  it('lists open commitments first and done ones last', () => {
    const ctx = assembleChatContext(assembleInput(), null);
    const lines = ctx.layers.memory.text.split('\n');
    expect(lines[1]).toBe('- [commitment, due 2026-11-07] Send the budget.');
    expect(lines[2]).toBe('- [open thread] Whether to move.');
    expect(lines[lines.length - 1]).toBe('- [commitment, done] Cancel the gym.');
  });

  it('leaves out an episode the recent messages already cover', () => {
    const input = assembleInput();
    input.episodes = [
      { id: 'old', startedAt: '2026-10-01T00:00:00Z', endedAt: '2026-10-01T01:00:00Z', messageCount: 4, summary: 'The old talk.' },
      { id: 'covered', startedAt: '2026-11-02T08:00:00Z', endedAt: '2026-11-02T08:00:00Z', messageCount: 1, summary: 'Covered.' },
    ];
    const text = assembleChatContext(input, null).layers.episodes.text;
    expect(text).toContain('The old talk.');
    expect(text).not.toContain('Covered.');
  });

  it('writes the date and time in the person\'s zone', () => {
    const text = assembleChatContext(assembleInput(), null).layers.live.text;
    expect(text.split('\n')[0]).toBe('Now: Tuesday 3 November 2026, 15:00 (Europe/London).');
  });
});

describe('recall', () => {
  it('is asked for only when the message refers back', () => {
    expect(refersBack('Remember the gym?')).toBe(true);
    expect(refersBack('Like you said last week, the budget')).toBe(true);
    expect(refersBack('Should I take it?')).toBe(false);
  });

  it('searches the nouns, not the words that refer back', () => {
    expect(recallQuery('Remember what you said about the Brex offer and my savings?')).toBe('brex or offer or savings');
    expect(recallQuery('You said that before')).toBeNull();
  });
});

describe('goals', () => {
  const goals = [
    { id: 'g1', title: 'Six months of savings', detail: null, area: 'Money', dueOn: null },
    { id: 'g2', title: 'Land a strategy role', detail: null, area: 'Career', dueOn: null },
    { id: 'g3', title: 'Play a nocturne', detail: null, area: 'Music', dueOn: null },
  ];

  it('ranks by the seat\'s area and the message\'s words', () => {
    const cfo = { key: 'cfo', question: 'What does this cost?', focus: null };
    expect(rankGoals(goals, cfo, 'hello').map((g) => g.id)).toEqual(['g1']);
    expect(rankGoals(goals, { key: 'seneca', question: 'Time?', focus: null }, 'the nocturne again').map((g) => g.id)).toEqual(['g3']);
    expect(rankGoals(goals, { key: 'seneca', question: 'Time?', focus: null }, 'hello')).toEqual([]);
  });
});

describe('chatPrompt', () => {
  it('caches the persona, joins one side\'s messages and opens with a user turn', () => {
    const ctx = assembleChatContext(assembleInput(), null);
    const { system, messages } = chatPrompt(ctx, { now: NOW, timeZone: TZ });
    expect(system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(system[0].text).toContain('You are the CFO');
    expect(system[1].text).toContain('What you remember about them:');
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    // A day passed between the mentor's note and the person's reply: it is marked.
    expect(messages[2].content).toBe('[Tue 3 Nov, 14:00] Thanks.\n\nWhat about the offer?');
  });
});

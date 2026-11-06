import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import type { SpendReport } from '@/lib/core/spend/pricing';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { claimTyping, MENTOR_LOOKUPS, REPLY_RULES, replyToMentor, type MentorSpendOperation } from './mentor-reply';
import { sendMentorText } from './mentor-send';
import { PEOPLE_ACTION_RULES, PEOPLE_WEB_RULES } from './people-actions';

/**
 * A stand-in for PostgREST over in-memory tables: select, insert and update,
 * with the filters the chat context, the send and the reply use.
 */
type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

let clock = Date.parse('2026-11-03T15:00:00Z');
const iso = () => new Date(clock).toISOString();

function fakeClient(tables: Tables, onInsert?: (table: string, row: Row) => void) {
  let ids = 0;
  const from = (schema: string) => (table: string) => {
    const name = `${schema}.${table}`;
    const all = (tables[name] ??= []);
    const filters: ((r: Row) => boolean)[] = [];
    let mode: 'select' | 'update' | 'insert' = 'select';
    let patch: Row = {};
    let inserted: Row[] = [];
    let limit = Infinity;
    let sort: { col: string; asc: boolean } | null = null;
    const matching = () => all.filter((r) => filters.every((f) => f(r)));
    const run = () => {
      if (mode === 'insert') return { data: inserted, error: null };
      if (mode === 'update') {
        const hit = matching();
        for (const r of hit) Object.assign(r, patch);
        return { data: hit, error: null };
      }
      let list = matching();
      if (sort) {
        const { col, asc } = sort;
        list = [...list].sort((a, b) => String(a[col] ?? '').localeCompare(String(b[col] ?? '')) * (asc ? 1 : -1));
      }
      return { data: list.slice(0, limit), error: null };
    };
    const chain = {
      select: () => chain,
      insert: (row: Row) => {
        mode = 'insert';
        const made = { id: `${table}-${++ids}`, created_at: iso(), ...row };
        clock += 1;
        all.push(made);
        inserted = [made];
        onInsert?.(name, made);
        return chain;
      },
      update: (values: Row) => ((mode = 'update'), (patch = values), chain),
      eq: (col: string, value: unknown) => (filters.push((r) => r[col] === value), chain),
      is: (col: string, value: null) => (filters.push((r) => (r[col] ?? null) === value), chain),
      not: (col: string) => (filters.push((r) => r[col] != null), chain),
      lt: (col: string, value: string) => (filters.push((r) => String(r[col]) < value), chain),
      gt: (col: string, value: string) => (filters.push((r) => String(r[col]) > value), chain),
      or: (expr: string) => {
        const before = /typing_until\.lt\.(\S+)$/.exec(expr)?.[1];
        if (before) filters.push((r) => r.typing_until == null || String(r.typing_until) < before);
        else filters.push(() => false); // the todo filter: no todos here
        return chain;
      },
      textSearch: () => chain,
      order: (col: string, opts: { ascending: boolean }) => ((sort = { col, asc: opts.ascending }), chain),
      limit: (n: number) => ((limit = n), chain),
      maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
      single: async () => ({ data: run().data[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown, reject?: (e: unknown) => unknown) => {
        try {
          return Promise.resolve(resolve(run()));
        } catch (error) {
          return reject ? reject(error) : Promise.reject(error);
        }
      },
    };
    return chain;
  };
  return { from: from('you'), schema: (s: string) => ({ from: from(s) }) } as unknown as YouSupabaseClient;
}

const USER = 'u1';
const CHAT = 'c1';
const ADVISOR = 'a1';

function world(): Tables {
  return {
    'you.advisor_chats': [{ id: CHAT, user_id: USER, advisor_id: ADVISOR, typing_until: null, reply_status: 'idle', last_message_at: iso() }],
    'you.board_advisors': [
      { id: ADVISOR, user_id: USER, key: 'money', name: 'Money', kind: 'seat', question: 'Can you afford it?', focus: null, persona: 'You talk plainly about cash.', brain: null, made_by_you: false },
    ],
    'you.advisor_messages': [
      { id: 'm1', user_id: USER, chat_id: CHAT, role: 'person', kind: 'reply', text: 'Should I take the offer?', created_at: iso() },
    ],
    'you.advisor_memory': [],
    'you.advisor_episodes': [],
  };
}

const start = (id: string, name: string) => ({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name, input: {} } });
const delta = (partial_json: string) => ({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json } });
const answerMessage = (answer: string) => ({
  content: [{ type: 'tool_use', id: 't1', name: 'answer', input: { answer, cited: [] } }],
  stop_reason: 'tool_use',
  usage: { input_tokens: 3_000, output_tokens: 80, cache_read_input_tokens: 19_000, cache_creation_input_tokens: 0 },
});

/** A client whose stream plays the answer's pieces, after `delayMs`, and whose plain call writes the first text. */
function anthropicStub(pieces: string[], options: { delayMs?: number; ack?: string; fail?: boolean; onPiece?: () => void } = {}) {
  const streamed: Record<string, unknown>[] = [];
  const created: Record<string, unknown>[] = [];
  const stub = {
    messages: {
      create: async (params: Record<string, unknown>) => {
        created.push(params);
        return {
          content: [{ type: 'text', text: options.ack ?? 'Hm, good one.' }],
          usage: { input_tokens: 900, output_tokens: 8 },
        };
      },
      stream: (params: Record<string, unknown>) => {
        streamed.push(params);
        const heard: ((event: unknown) => void)[] = [];
        return {
          on(name: string, fn: (event: unknown) => void) {
            if (name === 'streamEvent') heard.push(fn);
            return this;
          },
          async finalMessage() {
            if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
            if (options.fail) throw new Error('overloaded');
            const json = JSON.stringify({ answer: pieces.join(''), cited: [] });
            // Hand the JSON out a few characters at a time, as the API does.
            for (const fn of heard) fn(start('t1', 'answer'));
            for (let i = 0; i < json.length; i += 7) {
              for (const fn of heard) fn(delta(json.slice(i, i + 7)));
              options.onPiece?.();
              await Promise.resolve();
            }
            return answerMessage(pieces.join(''));
          },
        };
      },
    },
  } as unknown as Anthropic;
  return { stub, streamed, created };
}

function run(tables: Tables, stub: Anthropic, extra: Partial<Parameters<typeof replyToMentor>[0]> = {}) {
  const spent: { op: MentorSpendOperation; reports: SpendReport[] }[] = [];
  const client = fakeClient(tables);
  const promise = replyToMentor({
    client,
    userId: USER,
    chatId: CHAT,
    timeZone: 'Europe/London',
    model: 'claude-sonnet-5-5',
    anthropicApiKey: 'k',
    anthropic: stub,
    execute: vi.fn(),
    recordSpend: async (op, reports) => void spent.push({ op, reports }),
    claimed: true,
    now: () => clock,
    sleep: async () => undefined,
    ...extra,
  });
  return { promise, spent, client };
}

const mentorRows = (tables: Tables) => tables['you.advisor_messages'].filter((m) => m.role === 'advisor');

describe('replyToMentor', () => {
  it('saves each bubble of the reply as its own message, in order, and stops typing', async () => {
    const tables = world();
    const { stub, streamed, created } = anthropicStub(['Not yet.', '\n\nSix weeks of cash first.', '\n\nThen take it.']);
    const { promise, spent } = run(tables, stub);
    const outcome = await promise;

    expect(mentorRows(tables).map((m) => [m.kind, m.text])).toEqual([
      ['reply', 'Not yet.'],
      ['reply', 'Six weeks of cash first.'],
      ['reply', 'Then take it.'],
    ]);
    expect(created).toHaveLength(0);
    const chat = tables['you.advisor_chats'][0];
    expect(chat.typing_until).toBeNull();
    expect(chat.reply_status).toBe('idle');
    const person = tables['you.advisor_messages'][0];
    expect(person.delivered_at).toBeTruthy();
    expect(person.read_at).toBeTruthy();
    expect(outcome.rounds).toHaveLength(1);
    expect(outcome.rounds[0]).toMatchObject({ bubbles: 3, acked: false, ok: true });
    expect(outcome.rounds[0].costMicros).toBeGreaterThan(0);
    expect(spent.map((s) => s.op)).toEqual(['mentor-reply']);

    // The persona and the texting rules are cached; the rest follows uncached.
    const system = streamed[0].system as { text: string; cache_control?: unknown }[];
    expect(system[0].text).toContain('You talk plainly about cash.');
    expect(system[0].text).toContain(REPLY_RULES);
    expect(system[0].cache_control).toEqual({ type: 'ephemeral' });
    const tools = (streamed[0].tools as { name: string }[]).map((t) => t.name);
    expect(tools).toContain('todos');
    expect(tools).not.toContain('show_chart');
    expect(tools.at(-1)).toBe('answer');
  });

  it("acts with Ask Dash's tools and rules when it is given them (plan #2854.2)", async () => {
    const looking = anthropicStub(['Sure.']);
    await run(world(), looking.stub).promise;
    const lookupsOnly = (looking.streamed[0].tools as { name: string }[]).map((t) => t.name);
    expect(lookupsOnly).not.toContain('add_todo');

    const acting = anthropicStub(['Done, Friday it is.']);
    const act = { apply: vi.fn(), saveChange: vi.fn(), propose: vi.fn(), queue: vi.fn(), saveProposal: vi.fn() };
    await run(world(), acting.stub, { act }).promise;
    const tools = (acting.streamed[0].tools as { name: string }[]).map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(['todos', 'add_todo', 'add_plan_step', 'propose_build', 'propose_delete']));
    expect(tools).not.toContain('hand_off');
    expect(tools).not.toContain('show_chart');
    const system = (acting.streamed[0].system as { text: string }[]).map((b) => b.text).join('\n');
    expect(system).toContain(PEOPLE_ACTION_RULES);
    // Web search is in the core set, acting or not (plan #2861).
    expect(tools[0]).toBe('web_search');
    expect(lookupsOnly[0]).toBe('web_search');
    expect(system).toContain(PEOPLE_WEB_RULES);
  });

  it('saves the first bubble while the rest is still being written', async () => {
    const tables = world();
    let savedMidStream = 0;
    const { stub } = anthropicStub(['First bubble here.', '\n\nAnd a second, rather longer one to follow it.'], {
      onPiece: () => {
        savedMidStream = Math.max(savedMidStream, mentorRows(tables).length);
      },
    });
    await run(tables, stub).promise;
    expect(savedMidStream).toBeGreaterThanOrEqual(1);
    expect(mentorRows(tables)).toHaveLength(2);
  });

  it('sends a one-line first text when nothing is written after the wait', async () => {
    const tables = world();
    const { stub, created } = anthropicStub(['Here is the long answer.'], { delayMs: 60, ack: '"Ooh, let me think."' });
    const { promise, spent } = run(tables, stub, { ackAfterMs: 5 });
    const outcome = await promise;
    expect(mentorRows(tables).map((m) => [m.kind, m.text])).toEqual([
      ['ack', 'Ooh, let me think.'],
      ['reply', 'Here is the long answer.'],
    ]);
    expect(created[0].model).toBe('claude-haiku-5-5');
    expect(outcome.rounds[0].acked).toBe(true);
    expect(spent.map((s) => s.op).sort()).toEqual(['mentor-ack', 'mentor-reply']);
  });

  it('marks the chat failed, with the reason, when the reply cannot be written', async () => {
    const tables = world();
    const { stub } = anthropicStub([], { fail: true });
    const outcome = await run(tables, stub, { ackAfterMs: 10_000 }).promise;
    const chat = tables['you.advisor_chats'][0];
    expect(chat.reply_status).toBe('failed');
    expect(chat.reply_error).toMatch(/^Money could not reply just now/);
    expect(chat.typing_until).toBeNull();
    expect(mentorRows(tables)).toHaveLength(0);
    expect(outcome.error).toBeTruthy();
  });

  it('answers a message sent while it was replying, in the same run', async () => {
    const tables = world();
    let sentMore = false;
    const client = fakeClient(tables);
    const { stub, streamed } = anthropicStub(['Answer.'], {
      onPiece: () => {
        if (sentMore) return;
        sentMore = true;
        clock += 5;
        tables['you.advisor_messages'].push({ id: 'm2', user_id: USER, chat_id: CHAT, role: 'person', kind: 'reply', text: 'Also, the start date?', created_at: iso() });
      },
    });
    const outcome = await replyToMentor({
      client,
      userId: USER,
      chatId: CHAT,
      timeZone: 'Europe/London',
      model: 'claude-sonnet-5-5',
      anthropicApiKey: 'k',
      anthropic: stub,
      execute: vi.fn(),
      recordSpend: async () => undefined,
      claimed: true,
      now: () => clock,
      sleep: async () => undefined,
    });
    expect(outcome.rounds).toHaveLength(2);
    expect(streamed).toHaveLength(2);
    const lastTurn = (streamed[1].messages as { content: unknown }[]).at(-1);
    expect(JSON.stringify(lastTurn)).toContain('the start date');
  });

  it('sends the pictures and PDFs of the messages it answers before their words (plan #2974)', async () => {
    const tables = world();
    tables['you.advisor_messages'].push({
      id: 'm2',
      user_id: USER,
      chat_id: CHAT,
      role: 'person',
      kind: 'reply',
      text: 'Offer.pdf',
      created_at: new Date(clock + 1).toISOString(),
    });
    const { stub, streamed } = anthropicStub(['The base is 12% up.']);
    const readFiles = vi.fn(async () => [
      { name: 'Offer.pdf', kind: 'pdf' as const, data: 'JVBERi0=' },
    ]);
    const outcome = await run(tables, stub, { readFiles }).promise;
    expect(outcome.rounds[0]?.ok).toBe(true);
    // Both of the person's messages since the mentor last spoke.
    expect(readFiles).toHaveBeenCalledWith(['m1', 'm2']);
    const messages = streamed[0].messages as { role: string; content: unknown }[];
    const last = messages.at(-1);
    expect(last?.role).toBe('user');
    expect(JSON.stringify(last?.content)).toContain('"type":"document"');
  });

  it('still replies when the files cannot be read', async () => {
    const tables = world();
    const { stub } = anthropicStub(['Tell me what it says.']);
    const readFiles = vi.fn(async () => {
      throw new Error('storage is down');
    });
    const outcome = await run(tables, stub, { readFiles }).promise;
    expect(outcome.rounds[0]?.ok).toBe(true);
    expect(mentorRows(tables).map((m) => m.text)).toEqual(['Tell me what it says.']);
  });

  it('offers every lookup but the chart, and nothing that writes', () => {
    expect(MENTOR_LOOKUPS.every((t) => t.kind === 'lookup')).toBe(true);
    expect(MENTOR_LOOKUPS.some((t) => t.name === 'show_chart')).toBe(false);
  });
});

describe('claimTyping', () => {
  it('takes the chat when nobody is typing and refuses it while someone is', async () => {
    const tables = world();
    const client = fakeClient(tables);
    expect(await claimTyping(client, USER, CHAT, clock)).toBe(true);
    expect(tables['you.advisor_chats'][0].reply_status).toBe('waiting');
    expect(await claimTyping(client, USER, CHAT, clock + 1_000)).toBe(false);
    // Once the lease has run out, the next send takes it.
    expect(await claimTyping(client, USER, CHAT, clock + 60_000)).toBe(true);
  });

  it('leaves a reply that is already being written to answer the new message', async () => {
    const tables = world();
    tables['you.advisor_chats'][0].typing_until = new Date(clock + 10_000).toISOString();
    const sent = await sendMentorText({
      client: fakeClient(tables),
      userId: USER,
      mentor: { id: ADVISOR, name: 'Money', canTalk: true },
      text: 'One more thing',
      now: clock,
    });
    expect(sent).toMatchObject({ saved: true, chatId: CHAT, claimed: false });
    expect(tables['you.advisor_messages'].at(-1)).toMatchObject({ role: 'person', text: 'One more thing' });
  });
});

describe('sendMentorText with files (plan #2974)', () => {
  const upload = { path: `${USER}/00000000-0000-4000-8000-000000000001-shot.png`, name: 'Pasted image 1.png', contentType: 'image/png' as const, size: 2048 };

  it('saves a message of files alone as their names and records them against it', async () => {
    const tables = world();
    const recordFiles = vi.fn(async (messageId: string) => [
      { id: 'f1', name: upload.name, contentType: upload.contentType, size: upload.size, href: `/attachments/f1?m=${messageId}` },
    ]);
    const sent = await sendMentorText({
      client: fakeClient(tables),
      userId: USER,
      mentor: { id: ADVISOR, name: 'Money', canTalk: true },
      text: '  ',
      files: [upload],
      recordFiles,
      now: clock,
    });
    expect(sent.saved).toBe(true);
    const saved = tables['you.advisor_messages'].at(-1);
    expect(saved).toMatchObject({ role: 'person', text: 'Pasted image 1.png' });
    expect(recordFiles).toHaveBeenCalledWith(saved?.id, [upload]);
    expect(sent.saved && sent.files.map((f) => f.name)).toEqual(['Pasted image 1.png']);
  });

  it('refuses a message with neither words nor files', async () => {
    const sent = await sendMentorText({
      client: fakeClient(world()),
      userId: USER,
      mentor: { id: ADVISOR, name: 'Money', canTalk: true },
      text: '',
      now: clock,
    });
    expect(sent).toMatchObject({ saved: false });
  });
});

import { describe, expect, it } from 'vitest';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import {
  MAX_BOT_MESSAGES,
  MAX_OPENERS,
  MAX_PER_BOT,
  runGroupBurst,
  type DirectorInput,
  type DirectorPlan,
  type SpeakerInput,
} from '@/lib/you/group-burst';

const USER = 'u1';
const CHAT = 'g1';
type Row = Record<string, unknown>;

/**
 * A small in-memory PostgREST: eq, in, is, gt, order, limit, select,
 * insert, update, upsert, single. Enough for the burst's reads and writes.
 */
function memoryDb(tables: Record<string, Row[]>) {
  let seq = 0;
  let clock = Date.parse('2026-11-04T10:00:00Z');
  const stamp = () => new Date((clock += 1000)).toISOString();
  const client = {
    from(table: string) {
      const rows = (tables[table] ??= []);
      const filters: ((r: Row) => boolean)[] = [];
      let op: 'select' | 'insert' | 'update' | 'upsert' = 'select';
      let values: Row | Row[] | null = null;
      let orders: [string, boolean][] = [];
      let limit = Infinity;
      const run = () => {
        if (op === 'insert' || op === 'upsert') {
          const list = (Array.isArray(values) ? values : [values]) as Row[];
          const made = list.map((v) => {
            if (op === 'upsert' && table === 'advisor_message_reactions') {
              const old = rows.find((r) => r.message_id === v.message_id && r.advisor_id === v.advisor_id);
              if (old) return Object.assign(old, v);
            }
            const row = { id: `${table}-${++seq}`, created_at: stamp(), ...v };
            rows.push(row);
            return row;
          });
          return { data: made, error: null };
        }
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (op === 'update') {
          for (const r of hit) Object.assign(r, values);
          return { data: hit, error: null };
        }
        const sorted = [...hit].sort((x, y) => {
          for (const [col, asc] of orders) {
            const a = String(x[col] ?? '');
            const b = String(y[col] ?? '');
            if (a !== b) return (a < b ? -1 : 1) * (asc ? 1 : -1);
          }
          return 0;
        });
        return { data: sorted.slice(0, limit), error: null };
      };
      const chain: Record<string, unknown> = {
        select: () => chain,
        insert: (v: Row | Row[]) => ((op = 'insert'), (values = v), chain),
        update: (v: Row) => ((op = 'update'), (values = v), chain),
        upsert: (v: Row | Row[]) => ((op = 'upsert'), (values = v), chain),
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), chain),
        in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), chain),
        is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), chain),
        gt: (c: string, v: string) => (filters.push((r) => String(r[c]) > v), chain),
        or: () => chain,
        order: (c: string, o?: { ascending?: boolean }) => ((orders = [...orders, [c, o?.ascending !== false]]), chain),
        limit: (n: number) => ((limit = n), chain),
        single: () => {
          const r = run();
          return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: null });
        },
        maybeSingle: () => {
          const r = run();
          return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: null });
        },
        then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise.resolve(run()).then(resolve, reject),
      };
      return chain;
    },
  };
  return { client: client as unknown as YouSupabaseClient, tables, stamp };
}

const BOTS = ['Ada Lovelace', 'Ben Franklin', 'Cy Twombly', 'Dee Rams', 'Eve Curie', 'Fay Wray', 'Gus Grissom', 'Hal Abelson'].map((name) => ({
  id: `id-${name.split(' ')[0].toLowerCase()}`,
  key: name.split(' ')[0].toLowerCase(),
  name,
}));

function group(personSays: string, botCount = 8) {
  const bots = BOTS.slice(0, botCount);
  return memoryDb({
    advisor_chats: [{ id: CHAT, user_id: USER, kind: 'group', title: null, typing_until: null, last_read_at: null }],
    advisor_chat_members: bots.map((b, i) => ({
      chat_id: CHAT,
      advisor_id: b.id,
      user_id: USER,
      joined_at: `2026-11-01T00:00:0${i}Z`,
      left_at: null,
      typing_until: null,
    })),
    board_advisors: bots.map((b) => ({ ...b, user_id: USER, kind: 'seat', question: 'Why?', focus: null, persona: `You are ${b.name}.`, brain: null, colour: null })),
    advisor_memory: [],
    advisor_messages: [{ id: 'p1', user_id: USER, chat_id: CHAT, role: 'person', speaker_id: null, text: personSays, created_at: '2026-11-04T09:59:00Z' }],
    advisor_message_reactions: [],
  });
}

const base = (client: YouSupabaseClient) => ({
  client,
  userId: USER,
  chatId: CHAT,
  model: 'test-model',
  anthropicApiKey: 'test',
  recordSpend: async () => undefined,
  claimed: true,
  sleep: async () => undefined,
});

const botMessages = (tables: Record<string, Row[]>) => tables.advisor_messages.filter((m) => m.role === 'advisor');

/** Checks every cap over the bot messages after one message from the person. */
function expectCapsHold(said: Row[]) {
  expect(said.length).toBeLessThanOrEqual(MAX_BOT_MESSAGES);
  const count = new Map<unknown, number>();
  for (const [i, m] of said.entries()) {
    count.set(m.speaker_id, (count.get(m.speaker_id) ?? 0) + 1);
    if (i > 0) expect(m.speaker_id).not.toBe(said[i - 1].speaker_id);
  }
  for (const n of count.values()) expect(n).toBeLessThanOrEqual(MAX_PER_BOT);
}

describe('runGroupBurst (plan #2879.1.2)', () => {
  it('holds every cap when every bot is prompted to keep talking', async () => {
    const { client, tables } = group('Everyone, argue about this forever.');
    const looks: DirectorInput[] = [];
    // A director that always wants every bot to answer, for a reason that would let them.
    const director = async (input: DirectorInput): Promise<DirectorPlan> => {
      looks.push({ ...input, state: { ...input.state } });
      return { wait: false, picks: input.members.map((m) => ({ key: m.key, why: input.state.round === 0 ? 'answer' : 'question' })), reactions: [] };
    };
    // Bots that always toss a question to another bot, so none hands back to the person.
    const speak = async (input: SpeakerInput) => {
      const next = input.members.find((m) => m.id !== input.speaker.id)!;
      return `${next.name.split(' ')[0]}, keep going, what do you say?`;
    };
    const outcome = await runGroupBurst({ ...base(client), director, speak });
    const said = botMessages(tables);
    expectCapsHold(said);
    expect(said).toHaveLength(MAX_BOT_MESSAGES);
    expect(outcome.messages).toBe(MAX_BOT_MESSAGES);
    // The opening round is three; the director looked at most once per round, three rounds in all.
    expect(looks.length).toBeLessThanOrEqual(3);
    expect(looks[0].state.round).toBe(0);
    expect(said.slice(0, MAX_OPENERS).every((m) => typeof m.speaker_id === 'string')).toBe(true);
    // The lease is let go at the end, with every bot's typing.
    expect(tables.advisor_chats[0].typing_until).toBeNull();
    expect(tables.advisor_chat_members.every((m) => m.typing_until === null)).toBe(true);
  });

  it('waits on the person when the director says so, and writes nothing', async () => {
    const { client, tables } = group('ok thanks');
    const outcome = await runGroupBurst({
      ...base(client),
      director: async () => ({ wait: true, picks: [], reactions: [{ key: 'ada', line: 1, reaction: 'thumbs_up' }] }),
      speak: async () => 'never',
    });
    expect(botMessages(tables)).toHaveLength(0);
    expect(outcome.reactions).toBe(1);
    expect(tables.advisor_message_reactions[0]).toMatchObject({ advisor_id: 'id-ada', message_id: 'p1', reaction: 'thumbs_up' });
  });

  it('lets a bot the person named speak first, even when the director waits', async () => {
    const { client, tables } = group('@cy what do you think');
    await runGroupBurst({ ...base(client), director: async () => ({ wait: true, picks: [], reactions: [] }), speak: async () => 'I think so.' });
    expect(botMessages(tables).map((m) => m.speaker_id)).toEqual(['id-cy']);
  });

  it('ends the burst when a bot asks the person something', async () => {
    const { client, tables } = group('What should I do?');
    await runGroupBurst({
      ...base(client),
      director: async (input) => ({ wait: false, picks: input.members.slice(0, 3).map((m) => ({ key: m.key, why: 'answer' as const })), reactions: [] }),
      speak: async () => 'What matters most to you here?',
    });
    expect(botMessages(tables)).toHaveLength(1);
  });

  it('stops after the turn in hand when the person writes, and plans again from the new message', async () => {
    const { client, tables, stamp } = group('First thought');
    const anchors: string[] = [];
    let turns = 0;
    await runGroupBurst({
      ...base(client),
      director: async (input) => {
        const lastPerson = [...input.lines].reverse().find((l) => l.speakerId === null);
        anchors.push(lastPerson?.text ?? '');
        if (input.state.round > 0) return { wait: true, picks: [], reactions: [] };
        return { wait: false, picks: input.members.slice(0, 3).map((m) => ({ key: m.key, why: 'answer' as const })), reactions: [] };
      },
      speak: async () => {
        turns += 1;
        if (turns === 1) {
          tables.advisor_messages.push({ id: 'p2', user_id: USER, chat_id: CHAT, role: 'person', speaker_id: null, text: 'Actually, wait', created_at: stamp() });
        }
        return 'A plain statement.';
      },
    });
    // The turn in hand finished and landed; then the director planned from the
    // new message, and Ada, who had just spoken, could not go again straight away.
    expect(anchors[0]).toBe('First thought');
    expect(anchors[1]).toBe('Actually, wait');
    expect(botMessages(tables).map((m) => m.speaker_id)).toEqual(['id-ada', 'id-ben', 'id-cy']);
  });

  it('hands on to a chained request when time is short, keeping the lease', async () => {
    const { client, tables } = group('Go');
    tables.advisor_chats[0].typing_until = '2026-11-04T10:10:00Z';
    const chained: number[] = [];
    let clock = 1_000_000;
    const outcome = await runGroupBurst({
      ...base(client),
      now: () => (clock += 100_000),
      deadline: 1_000_000 + 200_000,
      chain: async ({ round }) => {
        chained.push(round);
      },
      director: async (input) => ({ wait: false, picks: input.members.slice(0, 3).map((m) => ({ key: m.key, why: 'answer' as const })), reactions: [] }),
      speak: async () => 'Statement.',
    });
    expect(outcome.chained).toBe(true);
    expect(chained).toEqual([0]);
    expect(tables.advisor_chats[0].typing_until).not.toBeNull();
  });

  it('records what the burst cost', async () => {
    const { client } = group('Hi');
    const kept: string[] = [];
    await runGroupBurst({
      ...base(client),
      recordSpend: async (op, reports) => {
        kept.push(`${op}:${reports.length}`);
      },
      director: async (_input, spent) => {
        spent.push({ model: 'claude-haiku-4-5', usage: { inputTokens: 10, outputTokens: 5 } } as never);
        return { wait: true, picks: [], reactions: [] };
      },
      speak: async () => null,
    });
    expect(kept).toEqual(['group-director:1']);
  });
});

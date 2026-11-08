import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import type { SpendReport } from '@/lib/core/spend/pricing';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import type { PlacesLookupInput, PlacesLookupResult } from '@/lib/you/places-lookup';
import { PAGE_RULES } from '@/lib/you/bot-pages';
import { SESSION_RULES } from '@/lib/talk/session-handoff';
import { BOT_HANDOFF_RULES, passedNote } from '@/lib/talk/hand-to-bot';
import { DIRECT_ASKED_RULES, DIRECT_RULES } from '@/lib/you/group-direct-message';
import { ATTACH_RULES, CHART_ONLY_RULES, NOTHING_ATTACHED, NOTHING_ATTACHED_CHART_ONLY } from '@/lib/talk/attachment-claim';
import {
  groupCaps,
  MAX_PER_BOT,
  PASS_WORD,
  runGroupBurst,
  SPEAKER_CODE_MAX_TOKENS,
  SPEAKER_MAX_LOOKUPS,
  SPEAKER_MAX_TOKENS,
  SPEAKER_PLACES_RULES,
  speakerText,
  speakWithModel,
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
        gte: (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), chain),
        not: (c: string, op: string, v: unknown) => (filters.push((r) => (op === 'is' ? (r[c] ?? null) !== v : r[c] !== v)), chain),
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

/** The Files API as a speaker's code left it: each id's name and type, and three bytes; an id not here cannot be read. */
function madeFilesClient(files: Record<string, { filename: string; mime_type: string }>): Anthropic {
  return {
    get: async (path: string) => {
      const file = files[/\/v1\/files\/([^/]+)/.exec(path)?.[1] ?? ''];
      if (!file) throw new Error('not found');
      return path.endsWith('/content') ? new Response(new Uint8Array([1, 2, 3])) : { ...file, size_bytes: 3 };
    },
  } as unknown as Anthropic;
}

/** Checks every cap over the bot messages after one message from the person. */
function expectCapsHold(said: Row[], most = groupCaps(8).messages) {
  expect(said.length).toBeLessThanOrEqual(most);
  const count = new Map<unknown, number>();
  for (const [i, m] of said.entries()) {
    count.set(m.speaker_id, (count.get(m.speaker_id) ?? 0) + 1);
    if (i > 0) expect(m.speaker_id).not.toBe(said[i - 1].speaker_id);
  }
  for (const n of count.values()) expect(n).toBeLessThanOrEqual(MAX_PER_BOT);
}

describe('runGroupBurst (plan #2879.1.2)', () => {
  it('holds every cap when every bot is prompted to keep talking', async () => {
    const { client, tables } = group('Argue about this forever.');
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
    // Eight bots: four answer the person and eight messages in all (plan #3080).
    expect(said).toHaveLength(groupCaps(8).messages);
    expect(outcome.messages).toBe(groupCaps(8).messages);
    // The director looked at most once per round, three rounds in all.
    expect(looks.length).toBeLessThanOrEqual(3);
    expect(looks[0].state.round).toBe(0);
    expect(said.slice(0, groupCaps(8).openers).every((m) => typeof m.speaker_id === 'string')).toBe(true);
    // The lease is let go at the end, with every bot's typing.
    expect(tables.advisor_chats[0].typing_until).toBeNull();
    expect(tables.advisor_chat_members.every((m) => m.typing_until === null)).toBe(true);
  });

  it('holds three openers and six messages in a group of three, as before (plan #3080)', async () => {
    const { client, tables } = group('Argue about this forever.', 3);
    const director = async (input: DirectorInput): Promise<DirectorPlan> => ({
      wait: false,
      picks: input.members.map((m) => ({ key: m.key, why: input.state.round === 0 ? 'answer' : 'question' })),
      reactions: [],
    });
    const speak = async (input: SpeakerInput) => `${input.members.find((m) => m.id !== input.speaker.id)!.name.split(' ')[0]}, what do you say?`;
    await runGroupBurst({ ...base(client), director, speak });
    const said = botMessages(tables);
    expectCapsHold(said, 6);
    expect(said).toHaveLength(6);
  });

  it('gives all eight one turn each when the person asks everyone, even when one asks the person something (plan #3080)', async () => {
    const { client, tables } = group('Everyone say one thing');
    const turns: SpeakerInput['turn'][] = [];
    await runGroupBurst({
      ...base(client),
      // A director that would pick only two, and then wait.
      director: async (input) =>
        input.state.round === 0 ? { wait: false, picks: [{ key: 'eve', why: 'answer' }, { key: 'ben', why: 'answer' }], reactions: [] } : { wait: true, picks: [], reactions: [] },
      speak: async (input) => {
        turns.push(input.turn);
        return input.speaker.key === 'cy' ? 'What would you say yourself?' : `${input.speaker.name} says one thing.`;
      },
    });
    const said = botMessages(tables).map((m) => m.speaker_id);
    expect(said).toEqual(['id-eve', 'id-ben', 'id-ada', 'id-cy', 'id-dee', 'id-fay', 'id-gus', 'id-hal']);
    // Each was asked, so none may pass, and each keeps it short.
    expect(turns.every((t) => t?.mayPass === false && t.brief === true)).toBe(true);
  });

  it('answers an ordinary message in a group of eight with a few, lets the others pass silently, and stops when nobody has more (plan #3080)', async () => {
    const { client, tables } = group('I am thinking about moving to Lisbon.');
    const looks: DirectorInput[] = [];
    const turns: { key: string; turn: SpeakerInput['turn'] }[] = [];
    await runGroupBurst({
      ...base(client),
      director: async (input) => {
        looks.push({ ...input, state: { ...input.state, spoken: [...input.state.spoken] } });
        return { wait: false, picks: input.members.map((m) => ({ key: m.key, why: input.state.round === 0 ? 'answer' : 'disagreement' })), reactions: [] };
      },
      speak: async (input) => {
        turns.push({ key: input.speaker.key, turn: input.turn });
        // Ada and Cy each have one thing to say; after that, and for everyone else, there is nothing new.
        const before = turns.filter((t) => t.key === input.speaker.key).length;
        if ((input.speaker.key === 'ada' || input.speaker.key === 'cy') && before === 1) return `${input.speaker.name} has a view.`;
        return PASS_WORD;
      },
    });
    const said = botMessages(tables);
    expect(said.map((m) => m.speaker_id)).toEqual(['id-ada', 'id-cy']);
    expect(said.every((m) => m.text !== PASS_WORD)).toBe(true);
    expectCapsHold(said);
    // Four were asked in the opening round; the first had to answer, the rest could pass.
    expect(turns.slice(0, 4).map((t) => t.key)).toEqual(['ada', 'ben', 'cy', 'dee']);
    expect(turns.slice(0, 4).map((t) => t.turn?.mayPass)).toEqual([false, true, true, true]);
    // Round 1 picked three; every one passed, so the director did not look a third time.
    expect(looks.map((l) => l.state.round)).toEqual([0, 1]);
  });

  it('gives "keep going" another short round from the quietest bots when the director picks nobody (plan #3080)', async () => {
    const { client, tables } = group('Tell me about Lisbon.');
    tables.advisor_messages.push(
      { id: 'b1', user_id: USER, chat_id: CHAT, role: 'advisor', speaker_id: 'id-ada', text: 'Hills.', created_at: '2026-11-04T09:59:10Z' },
      { id: 'b2', user_id: USER, chat_id: CHAT, role: 'advisor', speaker_id: 'id-ben', text: 'Trams.', created_at: '2026-11-04T09:59:20Z' },
      { id: 'p2', user_id: USER, chat_id: CHAT, role: 'person', speaker_id: null, text: 'keep going', created_at: '2026-11-04T09:59:30Z' },
    );
    await runGroupBurst({
      ...base(client),
      director: async () => ({ wait: true, picks: [], reactions: [] }),
      speak: async (input) => `${input.speaker.name} adds something.`,
    });
    const after = botMessages(tables).slice(2).map((m) => m.speaker_id);
    expect(after).toEqual(['id-cy', 'id-dee', 'id-eve', 'id-fay']);
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

  it('says nothing came through, and keeps a slip, when a bot claims a file it never sent (plan #3050.1)', async () => {
    const { client, tables } = group('@cy chart the markets');
    const recordSlip = vi.fn(async () => undefined);
    await runGroupBurst({
      ...base(client),
      recordSlip,
      director: async () => ({ wait: true, picks: [], reactions: [] }),
      speak: async () => "Here's the chart, attached as markets.png.",
    });
    expect(botMessages(tables).map((m) => m.text)).toEqual([`Here's the chart, attached as markets.png.\n\n${NOTHING_ATTACHED_CHART_ONLY}`]);
    expect(recordSlip).toHaveBeenCalledWith(expect.objectContaining({ kind: 'claimed_attachment', surface: 'people' }));
  });

  it('keeps a chart a bot drew on its text, and lets "here is the chart" through (plan #3050.2.2)', async () => {
    const { client, tables } = group('@cy chart the markets');
    const recordSlip = vi.fn(async () => undefined);
    await runGroupBurst({
      ...base(client),
      recordSlip,
      director: async () => ({ wait: true, picks: [], reactions: [] }),
      speak: async (input) => {
        input.charts?.push({ kind: 'bar', title: 'Week', rows: [{ label: 'S&P', value: 1.2 }], currency: null, unit: '%', columns: null, reference: null });
        return "Here's the chart: the S&P rose.";
      },
    });
    const [message] = botMessages(tables);
    expect(message.text).toBe("Here's the chart: the S&P rose.");
    expect(message.charts).toEqual([expect.objectContaining({ kind: 'bar', title: 'Week' })]);
    expect(recordSlip).not.toHaveBeenCalled();
  });

  it("keeps the files a bot's code made under its text, counts them, and says in a text of its own which could not be kept (plan #3050.3.3)", async () => {
    const { client, tables } = group('@cy send the markets chart as an image');
    const recordSlip = vi.fn(async () => undefined);
    const keepFiles = vi.fn(async (_id: string, files: { name: string }[]) => ({ kept: files.map((f) => ({ name: f.name })), unkept: [] }));
    const offered: (string[] | undefined)[] = [];
    await runGroupBurst({
      ...base(client),
      recordSlip,
      keepFiles,
      anthropic: madeFilesClient({
        png: { filename: '/tmp/outputs/markets.png', mime_type: 'image/png' },
        svg: { filename: 'markets.svg', mime_type: 'image/svg+xml' },
      }),
      director: async () => ({ wait: true, picks: [], reactions: [] }),
      speak: async (input) => {
        offered.push(input.made && [...input.made]);
        input.made?.push('png', 'svg');
        return "Here's the markets chart as a picture.";
      },
    });
    expect(offered).toEqual([[]]);
    const [text, note] = botMessages(tables);
    expect(text).toMatchObject({ text: "Here's the markets chart as a picture.", speaker_id: 'id-cy', file_count: 1 });
    expect(keepFiles).toHaveBeenCalledTimes(1);
    const [messageId, files] = keepFiles.mock.calls[0];
    expect(messageId).toBe(text.id);
    expect(files.map((f) => f.name)).toEqual(['markets.png']);
    expect(note).toMatchObject({ speaker_id: 'id-cy', role: 'advisor' });
    expect(note.text).toMatch(/^Sorry, a file did not come through\. markets\.svg could not be saved/);
    // A file its code made is not a false claim.
    expect(recordSlip).not.toHaveBeenCalled();
  });

  it("says so in the group when not one of the files a bot's code made could be read (plan #3050.3.3)", async () => {
    const { client, tables } = group('@cy send the markets chart as an image');
    const keepFiles = vi.fn(async () => ({ kept: [], unkept: [] }));
    await runGroupBurst({
      ...base(client),
      keepFiles,
      anthropic: madeFilesClient({}),
      director: async () => ({ wait: true, picks: [], reactions: [] }),
      speak: async (input) => {
        input.made?.push('gone');
        return 'Here it is as a picture.';
      },
    });
    const [text, note] = botMessages(tables);
    expect(text.file_count).toBeUndefined();
    expect(keepFiles).not.toHaveBeenCalled();
    expect(note.text).toContain('could not be fetched from where the code ran');
  });

  it('offers a speaker no code where nothing keeps its files, and says a claimed file did not come where something does (plan #3050.3.3)', async () => {
    const without = group('@cy chart it');
    const offered: (string[] | undefined)[] = [];
    await runGroupBurst({
      ...base(without.client),
      director: async () => ({ wait: true, picks: [], reactions: [] }),
      speak: async (input) => (offered.push(input.made), 'Sure.'),
    });
    expect(offered).toEqual([undefined]);

    const withKeep = group('@cy chart it');
    await runGroupBurst({
      ...base(withKeep.client),
      keepFiles: vi.fn(),
      director: async () => ({ wait: true, picks: [], reactions: [] }),
      speak: async () => "Here's the chart, attached as markets.png.",
    });
    expect(botMessages(withKeep.tables).map((m) => m.text)).toEqual([`Here's the chart, attached as markets.png.\n\n${NOTHING_ATTACHED}`]);
  });

  it('takes texts sent in a row as one message, waiting until they stop (plan #2988)', async () => {
    const { client, tables, stamp } = group('@cy quick one');
    let clock = Date.parse('2026-11-04T09:59:00Z');
    let more = 0;
    const plans: string[][] = [];
    await runGroupBurst({
      ...base(client),
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
        // Two more texts while the burst waits.
        if (more < 2) {
          more += 1;
          tables.advisor_messages.push({ id: `p-more-${more}`, user_id: USER, chat_id: CHAT, role: 'person', speaker_id: null, text: `and ${more}`, created_at: new Date(clock).toISOString() });
          stamp();
        }
      },
      director: async (input) => {
        plans.push(input.lines.filter((l) => l.speakerId === null).map((l) => l.text));
        return { wait: true, picks: [], reactions: [] };
      },
      speak: async () => 'One answer to all three.',
    });
    // The director planned once, with all three, and the bot named in the first text answered.
    expect(plans[0]).toEqual(['@cy quick one', 'and 1', 'and 2']);
    expect(botMessages(tables).map((m) => m.speaker_id)).toEqual(['id-cy']);
    expect(tables.advisor_chats[0].typing_until).toBeNull();
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

describe('a speaker looking places up (plan #2987.3)', () => {
  const USAGE = { input_tokens: 500, output_tokens: 40 };
  const speaker: SpeakerInput = {
    speaker: { id: 'a1', key: 'food', name: 'Mia', system: 'You love food.' },
    members: [
      { id: 'a1', key: 'food', name: 'Mia' },
      { id: 'a2', key: 'money', name: 'Sam' },
    ],
    transcript: '[1] The person: Find me a Thai place near my house',
  };
  const found: PlacesLookupResult = {
    status: 'ok',
    places: [
      {
        name: 'Kin Khao',
        address: '55 Cyril Magnin St',
        lat: 37.785,
        lng: -122.409,
        rating: 4.5,
        ratingCount: 2210,
        priceLevel: 2,
        openNow: true,
        todayHours: '5:00 – 9:30 PM',
        mapsUrl: 'https://maps.google.com/?cid=111',
        distanceMeters: 850,
        distanceFromNearMeters: null,
      },
    ],
    center: { lat: 37.78, lng: -122.41, label: 'home', isHome: true },
    radiusMeters: 2000,
    widened: false,
    cached: true,
    fetchedAt: '2026-11-06T19:00:00.000Z',
  };
  type Sent = { tools?: { name: string }[]; tool_choice?: { type: string }; system: { text: string }[]; messages: Anthropic.MessageParam[] };

  function scripted(replies: unknown[]) {
    const sent: Sent[] = [];
    const anthropic = {
      messages: {
        create: async (params: Sent) => {
          sent.push(structuredClone(params));
          return replies[sent.length - 1];
        },
      },
    } as unknown as Anthropic;
    return { anthropic, sent };
  }
  const lookup = (id: string) => ({ content: [{ type: 'tool_use', id, name: 'find_places', input: { query: 'thai restaurant' } }], usage: USAGE });
  const text = (t: string) => ({ content: [{ type: 'text', text: t }], usage: USAGE });

  it('offers find_places, runs it, and hands the places back before the bot texts', async () => {
    const { anthropic, sent } = scripted([lookup('p1'), text('Kin Khao, ten minutes away: https://maps.google.com/?cid=111')]);
    const asked: PlacesLookupInput[] = [];
    const spent: SpendReport[] = [];
    const said = await speakWithModel(anthropic, 'claude-sonnet-5-5', speaker, spent, async (input) => {
      asked.push(input);
      return found;
    });

    expect(sent[0].tools?.map((t) => t.name)).toEqual(['find_places']);
    expect(sent[0].tool_choice).toEqual({ type: 'auto' });
    expect(sent[0].system.map((b) => b.text).join('\n')).toContain(SPEAKER_PLACES_RULES);
    expect(asked).toEqual([{ query: 'thai restaurant', near: null, radiusMeters: null, openNow: false }]);
    const back = sent[1].messages.at(-1)?.content as Anthropic.ToolResultBlockParam[];
    expect(back[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'p1' });
    expect(back[0].is_error).toBeUndefined();
    expect(back[0].content).toContain('https://maps.google.com/?cid=111');
    expect(back[0].content).toContain('850 m');
    expect(said).toBe('Kin Khao, ten minutes away: https://maps.google.com/?cid=111');
    expect(spent).toHaveLength(2);
  });

  it("passes the lookup's refusal back in its own words, and stops offering it after the last lookup", async () => {
    const cap = "Dash has made today's 50 place lookups, the daily limit. Ask again tomorrow.";
    const replies = [...Array.from({ length: SPEAKER_MAX_LOOKUPS }, (_, i) => lookup(`p${i}`)), text('No more lookups today, sorry.')];
    const { anthropic, sent } = scripted(replies);
    const said = await speakWithModel(anthropic, 'claude-sonnet-5-5', speaker, [], async () => ({ status: 'refused', reason: 'cap_reached', message: cap }));

    const back = sent[1].messages.at(-1)?.content as Anthropic.ToolResultBlockParam[];
    expect(back[0]).toMatchObject({ content: cap, is_error: true });
    expect(sent).toHaveLength(SPEAKER_MAX_LOOKUPS + 1);
    expect(sent.at(-1)?.tool_choice).toEqual({ type: 'none' });
    expect(said).toBe('No more lookups today, sorry.');
  });

  it('offers make_page when the speaker can start one, and hands the start back before the bot texts (plan #2997)', async () => {
    const pageCall = { content: [{ type: 'tool_use', id: 'g1', name: 'make_page', input: { request: 'A drill.', title: 'Drill' } }], usage: USAGE };
    const { anthropic, sent } = scripted([pageCall, text("On it, I'll drop the link here.")]);
    const page = vi.fn(async () => ({ ok: true as const, rows: [], note: 'Started. Say you are on it.' }));
    const said = await speakWithModel(anthropic, 'claude-sonnet-5-5', { ...speaker, page }, []);

    expect(sent[0].tools?.map((t) => t.name)).toEqual(['make_page']);
    expect(sent[0].system.map((b) => b.text).join('\n')).toContain(PAGE_RULES);
    expect(page).toHaveBeenCalledWith({ request: 'A drill.', title: 'Drill' });
    const back = sent[1].messages.at(-1)?.content as Anthropic.ToolResultBlockParam[];
    expect(back[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'g1', content: 'Started. Say you are on it.' });
    expect(said).toBe("On it, I'll drop the link here.");
  });

  it('offers hand_off when the speaker can hand on, and hands the result back before the bot texts (plan #3005.2)', async () => {
    const handCall = { content: [{ type: 'tool_use', id: 'h1', name: 'hand_off', input: { request: 'A prep doc for Friday.' } }], usage: USAGE };
    const { anthropic, sent } = scripted([handCall, text("On it, I'll post it here.")]);
    const handOn = vi.fn(async () => ({ ok: true as const, rows: [], note: 'Handed on. Say you are on it.' }));
    const said = await speakWithModel(anthropic, 'claude-sonnet-5-5', { ...speaker, handOn }, []);

    expect(sent[0].tools?.map((t) => t.name)).toEqual(['hand_off']);
    expect(sent[0].system.map((b) => b.text).join('\n')).toContain(SESSION_RULES);
    expect(handOn).toHaveBeenCalledWith({ request: 'A prep doc for Friday.' });
    const back = sent[1].messages.at(-1)?.content as Anthropic.ToolResultBlockParam[];
    expect(back[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'h1', content: 'Handed on. Say you are on it.' });
    expect(said).toBe("On it, I'll post it here.");
  });

  it('offers hand_to_bot when the speaker can pass things on, and hands the result back before the bot texts (plan #3003.2)', async () => {
    const passCall = { content: [{ type: 'tool_use', id: 'p1', name: 'hand_to_bot', input: { to: 'Maya', summary: 'The plan.' } }], usage: USAGE };
    const { anthropic, sent } = scripted([passCall, text('Passed to Maya.')]);
    const passToBot = vi.fn(async () => ({ ok: true as const, rows: [], note: passedNote('Maya') }));
    const said = await speakWithModel(anthropic, 'claude-sonnet-5-5', { ...speaker, passToBot }, []);

    expect(sent[0].tools?.map((t) => t.name)).toEqual(['hand_to_bot']);
    expect(sent[0].system.map((b) => b.text).join('\n')).toContain(BOT_HANDOFF_RULES);
    expect(passToBot).toHaveBeenCalledWith({ to: 'Maya', summary: 'The plan.' });
    const back = sent[1].messages.at(-1)?.content as Anthropic.ToolResultBlockParam[];
    expect(back[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'p1', content: passedNote('Maya') });
    expect(said).toBe('Passed to Maya.');
  });

  it('offers message_person_directly with its rules (plan #3083), and the asked line only to a bot that was asked', async () => {
    const { anthropic, sent } = scripted([text('Sure.'), text('Sure.')]);
    const direct = vi.fn(async () => ({ ok: true as const, rows: [] }));
    await speakWithModel(anthropic, 'claude-sonnet-5-5', { ...speaker, direct, turn: { mayPass: false, brief: false, direct: true } }, []);
    await speakWithModel(anthropic, 'claude-sonnet-5-5', { ...speaker, direct }, []);
    expect(sent[0].tools?.map((t) => t.name)).toEqual(['message_person_directly']);
    expect(sent[0].system.map((b) => b.text).join('\n')).toContain(DIRECT_RULES);
    expect(sent[0].system.map((b) => b.text).join('\n')).toContain(DIRECT_ASKED_RULES);
    expect(sent[1].system.map((b) => b.text).join('\n')).toContain(DIRECT_RULES);
    expect(sent[1].system.map((b) => b.text).join('\n')).not.toContain(DIRECT_ASKED_RULES);
  });

  it('sends no tools when there is no way to look places up', async () => {
    const { anthropic, sent } = scripted([text('Try the noodle place.')]);
    expect(await speakWithModel(anthropic, 'claude-sonnet-5-5', speaker, [])).toBe('Try the noodle place.');
    expect(sent[0].tools).toBeUndefined();
    expect(sent[0].system.map((b) => b.text).join('\n')).toContain(CHART_ONLY_RULES);
  });

  it('runs code where its files are kept, carries on past a pause in the same container, and collects what the code wrote (plan #3050.3.3)', async () => {
    const ran = (fileId: string) => [
      { type: 'server_tool_use', id: `s-${fileId}`, name: 'bash_code_execution', input: { command: 'python chart.py' } },
      {
        type: 'bash_code_execution_tool_result',
        tool_use_id: `s-${fileId}`,
        content: { type: 'bash_code_execution_result', stdout: '', stderr: '', return_code: 0, content: [{ type: 'bash_code_execution_output', file_id: fileId }] },
      },
    ];
    const paused = { content: [{ type: 'text', text: 'Let me draw that.' }, ...ran('f-png')], stop_reason: 'pause_turn', container: { id: 'c1' }, usage: USAGE };
    const done = { content: [...ran('f-pdf'), { type: 'text', text: 'Here is the week as a picture and a PDF.' }], stop_reason: 'end_turn', usage: USAGE };
    const { anthropic, sent } = scripted([paused, done]);
    const made: string[] = [];
    const said = await speakWithModel(anthropic, 'claude-sonnet-5-5', { ...speaker, charts: [], made }, []);

    expect(sent[0].tools?.map((t) => t.name)).toEqual(['code_execution', 'show_chart']);
    expect(sent[0].system.map((b) => b.text).join('\n')).toContain(ATTACH_RULES);
    expect((sent[0] as unknown as { max_tokens: number }).max_tokens).toBe(SPEAKER_CODE_MAX_TOKENS);
    // The paused turn goes back as it was, in the container it ran in.
    expect(sent).toHaveLength(2);
    expect((sent[1] as unknown as { container?: string }).container).toBe('c1');
    expect(sent[1].messages.at(-1)).toMatchObject({ role: 'assistant' });
    expect(sent[1].tool_choice).toEqual({ type: 'auto' });
    expect(made).toEqual(['f-png', 'f-pdf']);
    expect(said).toBe('Here is the week as a picture and a PDF.');

    const plain = scripted([text('Sure.')]);
    await speakWithModel(plain.anthropic, 'claude-sonnet-5-5', speaker, []);
    expect((plain.sent[0] as unknown as { max_tokens: number }).max_tokens).toBe(SPEAKER_MAX_TOKENS);
  });

  it("reads a speaker's words after its code, not what it said it was about to do (plan #3050.3.3)", () => {
    const result = { type: 'bash_code_execution_tool_result' };
    expect(speakerText([{ type: 'text', text: 'Drawing it now.' }, { type: 'server_tool_use' }, result, { type: 'text', text: 'Here it is.' }])).toBe('Here it is.');
    expect(speakerText([{ type: 'text', text: 'Drawing it now.' }, { type: 'server_tool_use' }, result])).toBe('Drawing it now.');
    expect(speakerText([{ type: 'text', text: 'First.' }, { type: 'text', text: 'Second.' }])).toBe('First.');
    expect(speakerText([])).toBe('');
  });
});

describe('what a bot heard in its other chats (plan #2983)', () => {
  it("gives each speaker its memory page and its own one-on-one since the nightly run, and never another bot's", async () => {
    const { client, tables } = group('Ada, what do you think I should cook on Saturday?', 2);
    tables.advisor_chats.push(
      { id: 'd-ada', user_id: USER, kind: 'direct', advisor_id: 'id-ada', title: null },
      { id: 'd-ben', user_id: USER, kind: 'direct', advisor_id: 'id-ben', title: null },
    );
    tables.advisor_memory.push({ id: 'mem1', user_id: USER, advisor_id: 'id-ada', kind: 'fact', text: 'Keeps a sourdough starter.', retired_at: null, created_at: '2026-10-01T00:00:00Z' });
    tables.advisor_messages.push(
      { id: 'x1', user_id: USER, chat_id: 'd-ada', role: 'person', speaker_id: null, text: 'I have gone vegetarian this week.', created_at: '2026-11-04T09:50:00Z' },
      { id: 'x2', user_id: USER, chat_id: 'd-ben', role: 'person', speaker_id: null, text: 'Ben, keep this between us.', created_at: '2026-11-04T09:51:00Z' },
    );
    const heard: SpeakerInput[] = [];
    const director = async (input: DirectorInput): Promise<DirectorPlan> =>
      input.state.round === 0 ? { wait: false, picks: [{ key: 'ada', why: 'answer' }], reactions: [] } : { wait: true, picks: [], reactions: [] };
    const speak = async (input: SpeakerInput) => (heard.push(input), 'A mushroom risotto.');
    await runGroupBurst({ ...base(client), director, speak, timeZone: 'UTC' });
    const system = heard[0].speaker.system;
    expect(heard[0].speaker.id).toBe('id-ada');
    expect(system).toContain('Keeps a sourdough starter.');
    expect(system).toContain('[one-on-one with them, Wed 4 Nov 09:50] They: I have gone vegetarian this week.');
    expect(system).not.toContain('keep this between us');
    expect(system).not.toContain('what do you think I should cook');
  });
});

describe('a bot messaging the person in its own chat (plan #3083)', () => {
  const pickAll = async (input: DirectorInput): Promise<DirectorPlan> =>
    input.state.round === 0
      ? { wait: false, picks: input.members.slice(0, 3).map((m) => ({ key: m.key, why: 'answer' as const })), reactions: [] }
      : { wait: true, picks: [], reactions: [] };

  it('sends the asked bot\'s message to its chat, leaves a short line with a link in the group, and the others still answer', async () => {
    const { client, tables } = group('Ada can you message me individually to tell me more about your Cornell cafeteria situation. Anyone else, thoughts on what Ada is saying?', 3);
    const messageDirectly = vi.fn(async () => ({ ok: true as const, directChatId: 'dm-ada' }));
    const turns: { key: string; turn: SpeakerInput['turn'] }[] = [];
    await runGroupBurst({
      ...base(client),
      director: pickAll,
      messageDirectly,
      speak: async (input) => {
        turns.push({ key: input.speaker.key, turn: input.turn });
        if (input.speaker.key !== 'ada') return `${input.speaker.name} thinks the cafeteria sounds rough.`;
        expect(input.direct).toBeDefined();
        const result = await input.direct!({ ask: 'the full Cornell cafeteria story' });
        expect(result.ok && result.note).toContain('Sent');
        // A bot that tells the story here anyway is cut back to the pointer.
        return 'So it started in 2019 when the dining hall closed.\n\nThen the whole floor ate cereal for a month and the dean got involved, which was its own saga.';
      },
    });
    const said = botMessages(tables);
    expect(said.map((m) => m.speaker_id)).toEqual(['id-ada', 'id-ben', 'id-cy']);
    expect(said[0].text).toBe('Sent you the full thing in our chat.');
    expect(said[0].receipts).toEqual([{ label: 'Open your chat with Ada', link: '/chat/people/ada' }]);
    expect(said[1].receipts).toBeUndefined();
    expect(turns.map((t) => [t.key, t.turn?.direct])).toEqual([['ada', true], ['ben', false], ['cy', false]]);
    expect(messageDirectly).toHaveBeenCalledTimes(1);
    const [asker] = messageDirectly.mock.calls[0] as unknown as [{ bot: { key: string }; chatId: string; said: string; transcript: string }];
    expect(asker.bot.key).toBe('ada');
    expect(asker.chatId).toBe(CHAT);
    expect(asker.said).toContain('message me individually');
    expect(asker.transcript).toContain('The person:');
  });

  it('sends one message per bot when several are asked, and a second call in one turn sends nothing more', async () => {
    const { client, tables } = group('Ada and Ben, DM me your takes', 3);
    const messageDirectly = vi.fn(async () => ({ ok: true as const, directChatId: 'dm' }));
    await runGroupBurst({
      ...base(client),
      director: pickAll,
      messageDirectly,
      speak: async (input) => {
        await input.direct!({ ask: 'your take' });
        const again = await input.direct!({ ask: 'your take' });
        expect(again.ok && again.note).toContain('Already sent');
        return 'Sent you my take in our chat.';
      },
    });
    const said = botMessages(tables);
    expect(said.map((m) => m.speaker_id)).toEqual(['id-ada', 'id-ben']);
    expect(said.map((m) => m.text)).toEqual(['Sent you my take in our chat.', 'Sent you my take in our chat.']);
    expect(messageDirectly).toHaveBeenCalledTimes(2);
  });

  it('says in the group that it was not sent when the message fails, with no link', async () => {
    const { client, tables } = group('Ada, text me privately about it', 3);
    let told = '';
    await runGroupBurst({
      ...base(client),
      director: pickAll,
      messageDirectly: async () => ({ ok: false as const, error: 'your chat with them could not be opened.' }),
      speak: async (input) => {
        if (input.speaker.key !== 'ada') return PASS_WORD;
        const result = await input.direct!({ ask: 'it' });
        told = result.ok ? (result.note ?? '') : '';
        return 'I could not get it into our chat just now, sorry.';
      },
    });
    expect(told).toContain('It was not sent: your chat with them could not be opened.');
    const said = botMessages(tables);
    expect(said.map((m) => m.text)).toEqual(['I could not get it into our chat just now, sorry.']);
    expect(said[0].receipts).toBeUndefined();
  });

});

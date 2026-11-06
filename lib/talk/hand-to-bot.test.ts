import { describe, expect, it, vi } from 'vitest';
import { botHandoffRow, type BotHandoffInput, type BotHandoffRow } from './bot-handoff';
import {
  ASK_DASH_BOT,
  botAliases,
  botPassRequest,
  callName,
  passToBot,
  personWords,
  resolveBot,
  type BotEntry,
  type BotPassAsker,
  type BotPassPorts,
} from './hand-to-bot';

const USER = '00000000-0000-4000-8000-000000000001';
const ZENA = '00000000-0000-4000-8000-0000000000a1';
const BOB = '00000000-0000-4000-8000-0000000000b2';
const MAYA = '00000000-0000-4000-8000-0000000000c3';
const GERT = '00000000-0000-4000-8000-0000000000d4';
const CFO = '00000000-0000-4000-8000-0000000000e5';
const BOBBY = '00000000-0000-4000-8000-0000000000f6';
const CHAT = '00000000-0000-4000-8000-000000000c01';
const MESSAGE = '00000000-0000-4000-8000-000000000901';

const BOTS: BotEntry[] = [
  { id: ZENA, name: 'Zena the Researcher', key: 'zena' },
  { id: BOB, name: 'Bob Builder', key: 'builder' },
  { id: MAYA, name: 'Maya the Intelligent', key: 'maya_the_intelligent' },
  { id: GERT, name: 'Gert the Career Manager', key: 'hiring_manager' },
  { id: CFO, name: 'Damien Moneybags the CFO', key: 'cfo' },
];

/** The ports over an in-memory core.bot_handoffs, unique on (user_id, dedupe_key) as the table is. */
function store(bots: BotEntry[] = BOTS) {
  const rows: BotHandoffRow[] = [];
  const ports: BotPassPorts = {
    bots: async () => bots,
    keep: async (input: BotHandoffInput) => {
      const built = botHandoffRow(USER, input);
      if (!built.ok) return built;
      const at = rows.findIndex((r) => r.user_id === USER && r.dedupe_key === built.row.dedupe_key);
      if (at >= 0) return { ok: true, handoff: { id: `h${at + 1}` }, created: false };
      rows.push(built.row);
      return { ok: true, handoff: { id: `h${rows.length}` }, created: true };
    },
  };
  return { rows, ports };
}

const zena = (asked: string): BotPassAsker => ({
  fromBot: ZENA,
  source: { kind: 'direct', chatId: CHAT, botKey: 'zena' },
  messageId: MESSAGE,
  asked,
});

const seenAll = () => true;

describe('resolveBot', () => {
  it('finds a bot by the name People shows, its first name, its key or what follows "the"', () => {
    expect(resolveBot('Bob', BOTS)).toEqual({ kind: 'one', bot: BOTS[1] });
    expect(resolveBot('bob builder', BOTS)).toEqual({ kind: 'one', bot: BOTS[1] });
    expect(resolveBot('the builder', BOTS)).toEqual({ kind: 'one', bot: BOTS[1] });
    expect(resolveBot('Maya', BOTS)).toEqual({ kind: 'one', bot: BOTS[2] });
    expect(resolveBot('Gert', BOTS)).toEqual({ kind: 'one', bot: BOTS[3] });
    expect(resolveBot('the CFO', BOTS)).toEqual({ kind: 'one', bot: BOTS[4] });
    expect(resolveBot('Damien', BOTS)).toEqual({ kind: 'one', bot: BOTS[4] });
    expect(resolveBot('Moneybags', BOTS)).toEqual({ kind: 'one', bot: BOTS[4] });
  });

  it('finds Ask Dash as Dash', () => {
    expect(resolveBot('Dash', BOTS)).toEqual({ kind: 'one', bot: ASK_DASH_BOT });
    expect(resolveBot('Ask Dash', BOTS)).toEqual({ kind: 'one', bot: ASK_DASH_BOT });
  });

  it('is unclear when a name fits two bots, and none when it fits nobody', () => {
    const two = [...BOTS, { id: BOBBY, name: 'Bob Marley', key: 'marley' }];
    expect(resolveBot('Bob', two)).toEqual({ kind: 'unclear', candidates: [BOTS[1], two[5]] });
    expect(resolveBot('Bob Marley', two)).toEqual({ kind: 'one', bot: two[5] });
    expect(resolveBot('Steve', BOTS)).toEqual({ kind: 'none' });
    expect(resolveBot('  ', BOTS)).toEqual({ kind: 'none' });
  });

  it('calls a bot by its first name, and Ask Dash Dash', () => {
    expect(callName(BOTS[1])).toBe('Bob');
    expect(callName(ASK_DASH_BOT)).toBe('Dash');
    expect(botAliases(BOTS[3])).toEqual(['gert the career manager', 'gert', 'hiring manager', 'career manager']);
  });
});

describe('personWords', () => {
  it('keeps each text once, in order, so a text sent twice in a row is the same request', () => {
    expect(personWords(['Tell Bob to build it this way', 'tell bob to build it this way!', 'the Fish one'])).toBe(
      'Tell Bob to build it this way\nthe Fish one',
    );
    expect(personWords(['  ', ''])).toBe('');
  });
});

describe('botPassRequest', () => {
  it('needs a name, and drops refs no lookup returned', () => {
    expect(botPassRequest({ summary: 'x' })).toMatchObject({ ok: false });
    const parsed = botPassRequest(
      {
        to: ' Bob ',
        summary: 'Zena compared Fish Audio and ElevenLabs.',
        findings: ['Fish Audio is $5 a month', ' '],
        decisions: ['Go with Fish Audio'],
        refs: [
          { table: 'public.ideas', ref: 'i1', note: 'the idea' },
          { table: 'public.ideas', ref: 'made-up' },
        ],
      },
      (table, ref) => table === 'public.ideas' && ref === 'i1',
    );
    expect(parsed).toEqual({
      ok: true,
      to: 'Bob',
      packet: {
        summary: 'Zena compared Fish Audio and ElevenLabs.',
        findings: ['Fish Audio is $5 a month'],
        decisions: ['Go with Fish Audio'],
        refs: [{ ref: 'public.ideas:i1', note: 'the idea' }],
      },
    });
  });
});

describe('passToBot', () => {
  const call = {
    to: 'Bob',
    summary: 'We compared Fish Audio and ElevenLabs for voice in the chats.',
    findings: ['Fish Audio costs about $5 a month at our use; ElevenLabs about $22.'],
    decisions: ['Use Fish Audio.'],
  };

  it("keeps one row for Zena's 'tell Bob to build it this way' and tells her to say 'Passed to Bob.'", async () => {
    const { rows, ports } = store();
    const told = await passToBot(ports, zena('OK, tell Bob that I want you to build it this way'), call, seenAll);

    expect(told).toMatchObject({ ok: true, totals: { handoff: 'h1', to: 'Bob Builder' } });
    expect(told.ok && told.note).toContain('"Passed to Bob."');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: USER,
      from_bot: ZENA,
      to_bot: BOB,
      source_kind: 'direct',
      source_id: CHAT,
      source_link: '/chat/people/zena',
      source_message_id: MESSAGE,
      request: 'OK, tell Bob that I want you to build it this way',
      packet: {
        summary: call.summary,
        findings: call.findings,
        decisions: call.decisions,
      },
    });
  });

  it('makes no second row when the person repeats the text or the turn is retried, and says it was already passed', async () => {
    const { rows, ports } = store();
    await passToBot(ports, zena('Tell Bob to build it this way'), call);
    const again = await passToBot(ports, zena('tell bob to build it this way.'), { ...call, summary: 'Worded differently.' });
    const twiceInARow = await passToBot(ports, zena(personWords(['Tell Bob to build it this way', 'Tell Bob to build it this way'])), call);

    expect(rows).toHaveLength(1);
    for (const told of [again, twiceInARow]) {
      expect(told.ok && told.note).toContain('already passed to Bob');
      expect(told.ok && told.note).not.toMatch(/^Passed on/);
    }
  });

  it('makes one row when two bots in a group pass the same texts to the same bot', async () => {
    const { rows, ports } = store();
    const group = (fromBot: string): BotPassAsker => ({
      fromBot,
      source: { kind: 'group', chatId: CHAT },
      messageId: MESSAGE,
      asked: 'Hand this to Maya to put in the vault',
    });
    await passToBot(ports, group(GERT), { to: 'Maya', summary: 'The plan.' });
    await passToBot(ports, group(CFO), { to: 'Maya', summary: 'The plan, from me.' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ from_bot: GERT, to_bot: MAYA, source_link: `/chat/groups/${CHAT}` });
  });

  it('asks which bot when the name is unclear, and keeps nothing', async () => {
    const { rows, ports } = store([...BOTS, { id: BOBBY, name: 'Bob Marley', key: 'marley' }]);
    const told = await passToBot(ports, zena('Tell Bob to build it'), call);
    expect(rows).toHaveLength(0);
    expect(told.ok && told.note).toContain('"Bob" could be Bob Builder or Bob Marley');
    expect(told.ok && told.note).toContain('which one they mean');
  });

  it('asks who they mean when nobody has the name, naming who they can pass to', async () => {
    const { rows, ports } = store();
    const told = await passToBot(ports, zena('Tell Steve'), { ...call, to: 'Steve' });
    expect(rows).toHaveLength(0);
    expect(told.ok && told.note).toContain('nobody on People is called "Steve"');
    expect(told.ok && told.note).toContain('Bob Builder');
  });

  it('refuses a bot passing to itself', async () => {
    const { rows, ports } = store();
    const told = await passToBot(ports, zena('Tell Zena'), { ...call, to: 'Zena' });
    expect(rows).toHaveLength(0);
    expect(told.ok && told.note).toContain('that is you, Zena');
  });

  it('passes from Ask Dash to a bot, and from a bot to Ask Dash', async () => {
    const { rows, ports } = store();
    const conversationId = '00000000-0000-4000-8000-00000000a5c1';
    await passToBot(ports, { fromBot: null, source: { kind: 'ask', conversationId }, messageId: null, asked: 'Send this to Gert' }, { to: 'Gert', summary: 'A lead.' });
    const toDash = await passToBot(ports, zena('Hand this to Dash'), { to: 'Dash', summary: 'A todo.' });
    expect(rows.map((r) => [r.from_bot, r.to_bot, r.source_link])).toEqual([
      [null, GERT, `/chat/dash/${conversationId}`],
      [ZENA, null, '/chat/people/zena'],
    ]);
    expect(toDash.ok && toDash.note).toContain('"Passed to Dash."');
  });

  it('never throws: a failed read or save is told as not passed on', async () => {
    const failing: BotPassPorts = {
      bots: async () => BOTS,
      keep: vi.fn(async () => {
        throw new Error('down');
      }),
    };
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const told = await passToBot(failing, zena('Tell Bob'), call);
    expect(told.ok && told.note).toContain('It was not passed on');
    const noRoster = await passToBot({ ...failing, bots: async () => Promise.reject(new Error('down')) }, zena('Tell Bob'), call);
    expect(noRoster.ok && noRoster.note).toContain('could not be read');
    error.mockRestore();
  });

  it('refuses a call with no name, so the model can call again', async () => {
    const { ports } = store();
    expect(await passToBot(ports, zena('Tell Bob'), { summary: 'x' })).toMatchObject({ ok: false });
  });
});

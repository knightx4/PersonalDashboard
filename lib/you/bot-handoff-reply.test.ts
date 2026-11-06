import { describe, expect, it } from 'vitest';
import type { BotHandoffEnd } from '@/lib/talk/bot-handoff';
import type { BotHandoff } from '@/lib/talk/bot-handoffs';
import type { DashChange } from '@/lib/talk/changes';
import type { MentorHandoffTurn } from '@/lib/you/mentor-reply';
import {
  answerBotHandoff,
  CLAIM_WAIT_MS,
  handoffBrief,
  handoffLine,
  handoffResult,
  handoffRow,
  handoffRules,
  type HandoffBot,
  type HandoffReplyPorts,
} from './bot-handoff-reply';

const ZENA = '00000000-0000-4000-8000-00000000000a';
const BOB = '00000000-0000-4000-8000-00000000000b';
const JERWYN = '00000000-0000-4000-8000-00000000000c';
const MAYA = '00000000-0000-4000-8000-00000000000d';

const BOTS: Record<string, HandoffBot> = {
  [ZENA]: { id: ZENA, key: 'zena', name: 'Zena Researcher', canTalk: true },
  [BOB]: { id: BOB, key: 'builder', name: 'Bob Builder', canTalk: true },
  [JERWYN]: { id: JERWYN, key: 'jerwyn', name: 'Jerwyn', canTalk: true },
  [MAYA]: { id: MAYA, key: 'maya', name: 'Maya the Librarian', canTalk: true },
};

function handoff(fields: Partial<BotHandoff> = {}): BotHandoff {
  return {
    id: 'h1',
    fromBot: ZENA,
    toBot: BOB,
    sourceKind: 'direct',
    sourceId: '00000000-0000-4000-8000-0000000000f1',
    sourceLink: '/chat/people/zena',
    sourceMessageId: null,
    request: 'OK, tell Bob that I want you to build it this way',
    packet: {
      summary: 'Compared Fish Audio and ElevenLabs for voice in the chats.',
      findings: ['Fish Audio is about $0.015 a minute; ElevenLabs about $0.10.'],
      decisions: ['Fish Audio, kept under $5 a month.'],
    },
    status: 'sent',
    sentAt: '2026-11-06T10:00:00Z',
    pickedUpAt: null,
    doneAt: null,
    result: null,
    resultTable: null,
    resultId: null,
    error: null,
    dedupeKey: 'k',
    ...fields,
  };
}

function change(fields: Partial<DashChange>): DashChange {
  return {
    id: 'ch1',
    kind: 'add_plan_step',
    input: {},
    conversationId: '',
    turnId: null,
    status: 'done',
    subjectRef: null,
    writtenTable: null,
    writtenRef: null,
    undo: null,
    createdAt: '2026-11-06T10:00:05Z',
    doneAt: '2026-11-06T10:00:05Z',
    declinedAt: null,
    undoneAt: null,
    ...fields,
  } as DashChange;
}

/** Ports over one hand-off row and the bots' threads, recording what was written. */
function harness(row: BotHandoff, reply: (turn: MentorHandoffTurn) => { ok: boolean; error?: string; reply?: string; changes?: DashChange[] }) {
  const state = { row: { ...row } };
  const said: { chatId: string; text: string }[] = [];
  const ends: BotHandoffEnd[] = [];
  const turns: MentorHandoffTurn[] = [];
  const released: string[] = [];
  const announced: string[] = [];
  let claims = 0;
  const ports: HandoffReplyPorts & { busyFor: number } = {
    busyFor: 0,
    load: async () => ({ ...state.row }),
    bot: async (id) => BOTS[id] ?? null,
    directChat: async (bot) => `chat-${bot.key}`,
    claim: async () => ++claims > ports.busyFor,
    release: async (chatId) => void released.push(chatId),
    pickUp: async () => {
      if (state.row.status !== 'sent') return null;
      state.row = { ...state.row, status: 'picked_up', pickedUpAt: '2026-11-06T10:00:01Z' };
      return { ...state.row };
    },
    say: async (chatId, text) => {
      said.push({ chatId, text });
      return { id: `msg-${said.length}`, createdAt: '2026-11-06T10:00:02Z' };
    },
    reply: async (_chatId, turn) => {
      turns.push(turn);
      const out = reply(turn);
      return { ok: out.ok, error: out.error ?? null, reply: out.reply ?? '', changes: out.changes ?? [] };
    },
    end: async (_id, end) => {
      ends.push(end);
      state.row = { ...state.row, status: end.status, doneAt: '2026-11-06T10:00:09Z' };
    },
    announce: async (chatId) => void announced.push(chatId),
    now: () => Date.parse('2026-11-06T10:00:00Z') + claims * 5_000,
    sleep: async () => undefined,
  };
  return { ports, state, said, ends, turns, released, announced };
}

describe('answerBotHandoff (plan #3003.3)', () => {
  it('has Bob add the plan step Zena passed on and text in his own thread naming her and the step', async () => {
    const h = harness(handoff(), (turn) => {
      expect(turn.anchor.id).toBe('msg-1');
      return {
        ok: true,
        reply: "Zena filled me in on the voice chat update and I've sent it to be built now: #3010.",
        changes: [
          change({
            summary: 'Added plan step #3010 "Speak chat replies with Fish Audio" with its full detail.',
            writtenTable: 'public.plan_items',
            writtenRef: 'aaaaaaaa-0000-4000-8000-000000003010',
            subjectRef: 'public.plan_items:aaaaaaaa-0000-4000-8000-000000003010',
          }),
        ],
      };
    });
    const done = await answerBotHandoff(h.ports, 'h1');

    expect(done).toMatchObject({ status: 'done', chatId: 'chat-builder', row: { table: 'public.plan_items', id: 'aaaaaaaa-0000-4000-8000-000000003010' } });
    // His thread opens the turn with what Zena passed on; his changes hang from that line.
    expect(h.said).toEqual([{ chatId: 'chat-builder', text: handoffLine('Zena', 'OK, tell Bob that I want you to build it this way') }]);
    const turn = h.turns[0];
    expect(turn.brief).toContain('OK, tell Bob that I want you to build it this way');
    expect(turn.brief).toContain('Fish Audio is about $0.015 a minute');
    expect(turn.brief).toContain('Fish Audio, kept under $5 a month.');
    expect(turn.brief).toContain('/chat/people/zena');
    expect(turn.rules).toBe(handoffRules('Zena'));
    expect(turn.rules).toContain('name Zena');
    // The log row: picked up, then done with what he did and the row.
    expect(h.state.row.pickedUpAt).toBeTruthy();
    expect(h.ends).toEqual([
      {
        status: 'done',
        result: 'Made: Added plan step #3010 "Speak chat replies with Fish Audio" with its full detail.',
        row: { table: 'public.plan_items', id: 'aaaaaaaa-0000-4000-8000-000000003010' },
      },
    ]);
    expect(h.state.row.status).toBe('done');
    expect(h.announced).toEqual(['chat-builder']);
  });

  it('has Maya write the vault note Jerwyn passed on, from a group chat', async () => {
    const row = handoff({
      fromBot: JERWYN,
      toBot: MAYA,
      sourceKind: 'group',
      sourceLink: '/chat/groups/00000000-0000-4000-8000-0000000000f2',
      request: 'Hand this to Maya to put in the vault',
      packet: { summary: 'Planned the Lisbon trip: dates, budget and the three neighbourhoods.' },
    });
    const h = harness(row, () => ({
      ok: true,
      reply: 'Jerwyn filled me in on Lisbon. It is in the vault now: Lisbon trip plan.',
      changes: [change({ kind: 'add_quick_note', summary: 'Wrote the note "Lisbon trip plan".', writtenTable: 'vault.notes', writtenRef: 'n-1' })],
    }));
    const done = await answerBotHandoff(h.ports, 'h1');

    expect(done).toMatchObject({ status: 'done', chatId: 'chat-maya', row: { table: 'vault.notes', id: 'n-1' } });
    expect(h.said[0].text).toBe(handoffLine('Jerwyn', 'Hand this to Maya to put in the vault'));
    expect(h.turns[0].brief).toContain('a group chat Jerwyn is in');
    expect(h.ends[0]).toMatchObject({ status: 'done', result: 'Made: Wrote the note "Lisbon trip plan".' });
  });

  it('closes it done with what it asked when the receiver changed nothing', async () => {
    const h = harness(handoff(), () => ({ ok: true, reply: 'Zena passed me the voice work. Fish Audio for every bot, or only the mentors?' }));
    const done = await answerBotHandoff(h.ports, 'h1');
    expect(done).toMatchObject({ status: 'done', row: null });
    expect(h.ends[0]).toEqual({
      status: 'done',
      result: 'Changed nothing and replied: Zena passed me the voice work. Fish Audio for every bot, or only the mentors?',
      row: null,
    });
  });

  it('closes it failed with why when the reply fails', async () => {
    const h = harness(handoff(), () => ({ ok: false, error: 'Bob could not reply: overloaded.' }));
    expect(await answerBotHandoff(h.ports, 'h1')).toEqual({ status: 'failed', error: 'Bob could not reply: overloaded.' });
    expect(h.ends).toEqual([{ status: 'failed', error: 'Bob could not reply: overloaded.' }]);
    expect(h.announced).toEqual([]);
  });

  it('does nothing for a row already picked up, and lets go of the thread when another run took it', async () => {
    const picked = harness(handoff({ status: 'picked_up' }), () => ({ ok: true }));
    expect(await answerBotHandoff(picked.ports, 'h1')).toMatchObject({ status: 'skipped' });
    expect(picked.said).toEqual([]);

    const raced = harness(handoff(), () => ({ ok: true }));
    raced.ports.pickUp = async () => null;
    expect(await answerBotHandoff(raced.ports, 'h1')).toMatchObject({ status: 'skipped', why: 'Another run picked it up.' });
    expect(raced.released).toEqual(['chat-builder']);
    expect(raced.said).toEqual([]);
    expect(raced.ends).toEqual([]);
  });

  it('waits for a reply already being written in the thread, and leaves the row sent if it never ends', async () => {
    const waited = harness(handoff(), () => ({ ok: true, reply: 'Done.' }));
    waited.ports.busyFor = 2;
    expect(await answerBotHandoff(waited.ports, 'h1')).toMatchObject({ status: 'done' });

    const busy = harness(handoff(), () => ({ ok: true }));
    busy.ports.busyFor = CLAIM_WAIT_MS;
    expect(await answerBotHandoff(busy.ports, 'h1')).toMatchObject({ status: 'skipped' });
    expect(busy.state.row.status).toBe('sent');
  });

  it('fails a hand-off to Ask Dash, or to a bot no longer on People', async () => {
    const dash = harness(handoff({ toBot: null }), () => ({ ok: true }));
    expect(await answerBotHandoff(dash.ports, 'h1')).toMatchObject({ status: 'failed' });
    const gone = harness(handoff({ toBot: '00000000-0000-4000-8000-0000000000ee' }), () => ({ ok: true }));
    expect(await answerBotHandoff(gone.ports, 'h1')).toEqual({ status: 'failed', error: 'The bot it was passed to is not on People any more.' });
  });
});

describe('the hand-off text', () => {
  it('quotes a long request cut, and names Dash as the sender from Ask Dash', () => {
    const line = handoffLine('Dash', 'word '.repeat(200));
    expect(line.startsWith('Dash passed this on to me from your chat: “')).toBe(true);
    expect(line.length).toBeLessThan(340);
    expect(handoffBrief(handoff({ packet: {} }), 'Dash')).not.toContain('summary');
  });

  it('keeps the first row written and lists proposals apart', () => {
    const changes = [
      change({ status: 'proposed', kind: 'start_build', summary: null }),
      change({ summary: 'Added todo "Call the bank".', writtenTable: 'todo.items', writtenRef: 't1' }),
    ];
    expect(handoffRow(changes)).toEqual({ table: 'todo.items', id: 't1' });
    expect(handoffResult(changes, '')).toBe('Made: Added todo "Call the bank". Proposed: start build.');
  });
});

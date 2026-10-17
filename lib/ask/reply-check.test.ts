import { describe, expect, it } from 'vitest';
import {
  batchChats,
  chatsToCheck,
  checkWindow,
  mergeFlags,
  noteBody,
  readFlags,
  runReplyCheckFor,
  weekToCheck,
  type CheckTurn,
  type Flag,
  type ReplyCheckPorts,
  type ThumbsDown,
} from './reply-check';

const ASK_A = '11111111-1111-4111-8111-111111111111';
const ASK_B = '22222222-2222-4222-8222-222222222222';
const HANDED = '33333333-3333-4333-8333-333333333333';
const ROW_THREAD = '44444444-4444-4444-8444-444444444444';

function turn(id: string, conversationId: string, role: CheckTurn['role'], body: string, createdAt: string): CheckTurn {
  return { id, conversationId, role, body, createdAt };
}

describe('the week checked', () => {
  it('is the Monday-to-Sunday week that ended before the Monday call', () => {
    // Monday 19 October 2026, 13:23 UTC is 09:23 in New York.
    expect(weekToCheck(new Date('2026-10-19T13:23:00Z'))).toBe('2026-10-12');
    // Still Sunday night in New York: the week before that.
    expect(weekToCheck(new Date('2026-10-19T03:00:00Z'))).toBe('2026-10-05');
  });

  it('runs from New York midnight to New York midnight, across a clock change', () => {
    expect(checkWindow('2026-10-12')).toEqual({
      from: '2026-10-12T04:00:00.000Z',
      to: '2026-10-19T04:00:00.000Z',
    });
    // The week the clocks go back on Sunday 1 November.
    expect(checkWindow('2026-10-26')).toEqual({
      from: '2026-10-26T04:00:00.000Z',
      to: '2026-11-02T05:00:00.000Z',
    });
    expect(() => checkWindow('2026-10-13')).toThrow();
  });
});

describe('the chats read', () => {
  const window = checkWindow('2026-10-12');
  const turns = [
    turn('a1', ASK_A, 'user', 'What is on today?', '2026-10-13T14:00:00Z'),
    turn('a2', ASK_A, 'assistant', 'Nothing.', '2026-10-13T14:00:05Z'),
    turn('h1', HANDED, 'user', 'Add this to my shopping list', '2026-10-13T15:00:00Z'),
    turn('h2', HANDED, 'assistant', 'I cannot; handing on.', '2026-10-13T15:00:05Z'),
    turn('r1', ROW_THREAD, 'user', '@dash why?', '2026-10-13T16:00:00Z'),
    turn('o1', ASK_B, 'user', 'Last week', '2026-10-11T16:00:00Z'),
  ];

  it('keeps Ask Dash chats in the week and leaves out those handed off', () => {
    const chats = chatsToCheck(turns, new Set([ASK_A, ASK_B, HANDED]), new Set([HANDED]), window);
    expect(chats.map((chat) => chat.id)).toEqual([ASK_A]);
    expect(chats[0].turns.map((t) => t.id)).toEqual(['a1', 'a2']);
  });

  it('cuts Dash answers to 600 characters, keeps the person whole, and splits past the limit', () => {
    const long = 'x'.repeat(2000);
    const chats = [
      { id: ASK_A, turns: [turn('u', ASK_A, 'user', long, '2026-10-13T14:00:00Z'), turn('d', ASK_A, 'assistant', long, '2026-10-13T14:00:01Z')] },
      { id: ASK_B, turns: [turn('u2', ASK_B, 'user', 'hi', '2026-10-14T14:00:00Z')] },
    ];
    const [one] = batchChats(chats);
    expect(one.text).toContain(`Person: ${long}`);
    expect(one.text).toContain(`Dash: ${'x'.repeat(600)}…`);
    expect(one.text).not.toContain(`Dash: ${'x'.repeat(601)}`);
    expect(one.labels.get('T2')?.id).toBe('d');
    const split = batchChats(chats, 2650);
    expect(split).toHaveLength(2);
    expect(split[1].labels.get('T3')?.id).toBe('u2');
  });
});

describe('the flags', () => {
  const chats = [
    {
      id: ASK_A,
      turns: [
        turn('a1', ASK_A, 'user', 'What is on today?', '2026-10-13T14:00:00Z'),
        turn('a2', ASK_A, 'assistant', 'Nothing.', '2026-10-13T14:00:05Z'),
        turn('a3', ASK_A, 'user', 'That is wrong, I have a dentist at 3', '2026-10-13T14:01:00Z'),
      ],
    },
  ];
  const [batch] = batchChats(chats);

  it('keep only Dash turns named by label with a known kind, quoting the next turn when the model gives none', () => {
    const flags = readFlags(
      [
        { reply: 'T2', kind: 'pushed_back', quote: '' },
        { reply: 'T1', kind: 'pushed_back', quote: 'x' },
        { reply: 'T9', kind: 'gave_up', quote: 'x' },
        { reply: 'T2', kind: 'angry', quote: 'x' },
      ],
      batch,
    );
    expect(flags).toEqual([
      {
        turn_id: 'a2',
        conversation_id: ASK_A,
        kind: 'pushed_back',
        quote: 'That is wrong, I have a dentist at 3',
        at: '2026-10-13T14:00:05Z',
      },
    ]);
  });

  it('list every thumbs-down whatever the check says, once per reply', () => {
    const downs: ThumbsDown[] = [
      { turnId: 'a2', conversationId: ASK_A, createdAt: '2026-10-13T14:00:05Z', note: 'Missed the dentist', asked: 'What is on today?' },
      { turnId: 'b2', conversationId: ASK_B, createdAt: '2026-10-12T14:00:05Z', note: null, asked: 'Book a table' },
    ];
    const merged = mergeFlags(downs, readFlags([{ reply: 'T2', kind: 'pushed_back', quote: 'wrong' }], batch));
    expect(merged.map((flag) => [flag.turn_id, flag.kind, flag.quote])).toEqual([
      ['b2', 'down', 'Book a table'],
      ['a2', 'down', 'Missed the dentist'],
    ]);
  });
});

describe('the note', () => {
  it('heads the week and gives a line per reply with its day, why and its chat', () => {
    const body = noteBody('2026-10-12', [
      { turn_id: 'a2', conversation_id: ASK_A, kind: 'down', quote: 'Missed the dentist', at: '2026-10-13T14:00:05Z' },
      { turn_id: 'b2', conversation_id: ASK_B, kind: 'repeated', quote: 'I said Friday', at: '2026-10-15T20:00:00Z' },
    ]);
    expect(body).toBe(
      [
        'Ask Dash replies that went badly, week of 12 October 2026',
        '',
        `- Tue 13 Oct, you marked it down: "Missed the dentist". /ask/${ASK_A}`,
        `- Thu 15 Oct, you repeated yourself: "I said Friday". /ask/${ASK_B}`,
      ].join('\n'),
    );
  });

  it('stays within the 4000 characters a note holds', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      turn_id: `t${i}`,
      conversation_id: ASK_A,
      kind: 'gave_up' as const,
      quote: 'q'.repeat(140),
      at: '2026-10-13T14:00:05Z',
    }));
    const body = noteBody('2026-10-12', many);
    expect(body.length).toBeLessThanOrEqual(4000);
    expect(body).toMatch(/- And \d+ more, kept with this week's check\.$/);
  });
});

type Store = { rows: Map<string, { model: string; flagged: Flag[]; note_id: string | null }>; notes: string[]; spend: number };

function fakePorts(
  store: Store,
  input: { chats?: ReturnType<typeof chatsToCheck>; downs?: ThumbsDown[]; flags?: unknown; noKey?: boolean },
): ReplyCheckPorts {
  return {
    async hasCheck(userId, week) {
      return store.rows.has(`${userId}:${week}`);
    },
    async chats() {
      return input.chats ?? [];
    },
    async thumbsDown() {
      return input.downs ?? [];
    },
    async check(_batch, onSpend) {
      if (input.noKey) return null;
      onSpend({ model: 'haiku', usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 } as never });
      return { model: 'haiku', flags: input.flags ?? [] };
    },
    async ledger() {
      store.spend += 1;
    },
    async claim(row) {
      const key = `${row.user_id}:${row.week}`;
      if (store.rows.has(key)) return false;
      store.rows.set(key, { model: row.model, flagged: row.flagged, note_id: null });
      return true;
    },
    async writeNote(_userId, body) {
      store.notes.push(body);
      return `note-${store.notes.length}`;
    },
    async linkNote(userId, week, noteId) {
      store.rows.get(`${userId}:${week}`)!.note_id = noteId;
    },
    async release(userId, week) {
      store.rows.delete(`${userId}:${week}`);
    },
  };
}

describe('a run', () => {
  const now = new Date('2026-10-19T13:23:00Z');
  const user = 'owner';
  const chats = [
    {
      id: ASK_A,
      turns: [
        turn('a1', ASK_A, 'user', 'What is on today?', '2026-10-13T14:00:00Z'),
        turn('a2', ASK_A, 'assistant', 'Nothing.', '2026-10-13T14:00:05Z'),
        turn('a3', ASK_A, 'user', 'That is wrong', '2026-10-13T14:01:00Z'),
      ],
    },
  ];

  it('writes one note after a pushback, records the spend, and a second call that week writes nothing', async () => {
    const store: Store = { rows: new Map(), notes: [], spend: 0 };
    const ports = fakePorts(store, { chats, flags: [{ reply: 'T2', kind: 'pushed_back', quote: 'That is wrong' }] });
    const first = await runReplyCheckFor(ports, user, now);
    expect(first).toMatchObject({ status: 'noted', week: '2026-10-12', flagged: 1, noteId: 'note-1' });
    expect(store.notes).toHaveLength(1);
    expect(store.notes[0]).toContain(`/ask/${ASK_A}`);
    expect(store.rows.get(`${user}:2026-10-12`)).toMatchObject({ model: 'haiku', note_id: 'note-1' });
    expect(store.spend).toBe(1);

    expect(await runReplyCheckFor(ports, user, new Date('2026-10-19T19:23:00Z'))).toEqual({
      status: 'already-checked',
      week: '2026-10-12',
    });
    expect(store.notes).toHaveLength(1);
    expect(store.spend).toBe(1);
  });

  it('lists a thumbs-down even with no key to ask a model', async () => {
    const store: Store = { rows: new Map(), notes: [], spend: 0 };
    const downs = [{ turnId: 'a2', conversationId: ASK_A, createdAt: '2026-10-13T14:00:05Z', note: 'Wrong day', asked: null }];
    const result = await runReplyCheckFor(fakePorts(store, { chats, downs, noKey: true }), user, now);
    expect(result).toMatchObject({ status: 'noted', flagged: 1 });
    expect(store.notes[0]).toContain('you marked it down: "Wrong day"');
    expect(store.rows.get(`${user}:2026-10-12`)?.model).toBe('none');
  });

  it('stores the row and no note on a quiet week', async () => {
    const store: Store = { rows: new Map(), notes: [], spend: 0 };
    const result = await runReplyCheckFor(fakePorts(store, { chats, flags: [] }), user, now);
    expect(result).toEqual({ status: 'quiet', week: '2026-10-12', chats: 1 });
    expect(store.notes).toHaveLength(0);
    expect(store.rows.get(`${user}:2026-10-12`)).toMatchObject({ flagged: [], note_id: null });
  });

  it('takes the row back when the note cannot be written, so a later call tries again', async () => {
    const store: Store = { rows: new Map(), notes: [], spend: 0 };
    const ports = fakePorts(store, { chats, flags: [{ reply: 'T2', kind: 'gave_up', quote: 'never mind' }] });
    ports.writeNote = async () => {
      throw new Error('down');
    };
    await expect(runReplyCheckFor(ports, user, now)).rejects.toThrow('down');
    expect(store.rows.size).toBe(0);
  });
});

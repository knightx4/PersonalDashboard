import { describe, expect, it, vi } from 'vitest';
import {
  askedDirect,
  directAnchorLine,
  directBrief,
  directRequestOf,
  pointerText,
  POINTER_MAX,
  sendDirect,
  wantsDirect,
  type DirectAsker,
  type DirectPorts,
} from '@/lib/you/group-direct-message';

describe('wantsDirect (plan #3083)', () => {
  it.each([
    'richard can you message me individually to tell me more about your Cornell cafeteria situation',
    'Richard and Leonardo, DM me your takes',
    'tell me privately what you think',
    'can you text me about it one on one',
    'send me the details separately',
    'explain it in our own chat',
    'pm me',
  ])('reads "%s" as asking for a direct message', (text) => {
    expect(wantsDirect(text)).toBe(true);
  });

  it.each(['what do you all think?', 'message the landlord individually', 'tell me more about it', 'meet at 3 pm?'])('does not read "%s" as one', (text) => {
    expect(wantsDirect(text)).toBe(false);
  });

  it('names the bots asked: the named ones, or everyone, or nobody', () => {
    const ids = ['a', 'b', 'c'];
    expect(askedDirect('Ada, DM me', { named: ['a'], everyone: false }, ids)).toEqual(['a']);
    expect(askedDirect('everyone DM me your take', { named: [], everyone: true }, ids)).toEqual(ids);
    expect(askedDirect('can someone DM me', { named: [], everyone: false }, ids)).toEqual([]);
    expect(askedDirect('Ada, what do you think', { named: ['a'], everyone: false }, ids)).toEqual([]);
  });
});

describe('what goes to the bot\'s own chat (plan #3083)', () => {
  it('reads the tool input and refuses one with no ask', () => {
    expect(directRequestOf({ ask: ' the story ', summary: '' })).toEqual({ ok: true, ask: 'the story', summary: null });
    expect(directRequestOf({ summary: 'x' }).ok).toBe(false);
  });

  it('names the group in the line and the brief, with the link back', () => {
    expect(directAnchorLine('Ada, Ben and Cy', 'Ada, DM me\nplease')).toBe('You asked me in Ada, Ben and Cy to message you here: “Ada, DM me please”');
    const brief = directBrief({ groupTitle: 'Supper club', chatId: 'g1', said: 'Ada, DM me', transcript: '[1] The person: Ada, DM me', request: { ask: 'the story', summary: 'Talking about food.' } });
    expect(brief).toContain('(/chat/groups/g1)');
    expect(brief).toContain('What they want from you here:\nthe story');
    expect(brief).toContain('Your summary of the group exchange:\nTalking about food.');
    expect(brief).toContain('[1] The person: Ada, DM me');
  });

  it('keeps a short pointer and cuts back a long one or none', () => {
    expect(pointerText('Sent it to our chat.')).toBe('Sent it to our chat.');
    expect(pointerText('x'.repeat(POINTER_MAX + 1))).toBe('Sent you the full thing in our chat.');
    expect(pointerText('Sent.\n\nAnd here is the story anyway.')).toBe('Sent you the full thing in our chat.');
    expect(pointerText(null)).toBe('Sent you the full thing in our chat.');
  });
});

describe('sendDirect (plan #3083)', () => {
  const asker: DirectAsker = {
    bot: { id: 'id-ada', key: 'ada', name: 'Ada Lovelace' },
    chatId: 'g1',
    groupTitle: 'Supper club',
    said: 'Ada, DM me the story',
    transcript: '[1] The person: Ada, DM me the story',
  };

  function ports(over: Partial<DirectPorts> = {}) {
    const said: { chatId: string; text: string; receipts: unknown }[] = [];
    const p: DirectPorts = {
      directChat: async () => 'dm-ada',
      claim: async () => true,
      release: vi.fn(async () => undefined),
      say: async (chatId, text, receipts) => {
        said.push({ chatId, text, receipts });
        return { id: 'm1', createdAt: '2026-11-08T10:00:00Z' };
      },
      reply: vi.fn(async () => ({ ok: true, error: null, reply: 'So, the cafeteria.' })),
      announce: vi.fn(),
      now: () => 0,
      sleep: async () => undefined,
      ...over,
    };
    return { p, said };
  }

  it('writes the line with a link back, replies with the request as the last turn, and tells the person', async () => {
    const { p, said } = ports();
    expect(await sendDirect(p, asker, { ask: 'the full story' })).toEqual({ ok: true, directChatId: 'dm-ada' });
    expect(said).toEqual([
      { chatId: 'dm-ada', text: 'You asked me in Supper club to message you here: “Ada, DM me the story”', receipts: [{ label: 'Back to Supper club', link: '/chat/groups/g1' }] },
    ]);
    const turn = (p.reply as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(turn.anchor).toEqual({ id: 'm1', createdAt: '2026-11-08T10:00:00Z' });
    expect(turn.brief).toContain('the full story');
    expect(turn.rules).toContain('Supper club');
    expect(p.announce).toHaveBeenCalledWith('dm-ada', asker.bot, expect.any(String));
  });

  it('says why when the chat stays busy, the reply fails or writes nothing, and never announces', async () => {
    let t = 0;
    const busy = ports({ claim: async () => false, now: () => (t += 5_000) });
    const r1 = await sendDirect(busy.p, asker, { ask: 'it' });
    expect(r1).toEqual({ ok: false, error: "a reply of Ada's was still being written in that chat." });
    expect(busy.said).toHaveLength(0);

    const failed = ports({ reply: async () => ({ ok: false, error: 'boom', reply: '' }) });
    expect(await sendDirect(failed.p, asker, { ask: 'it' })).toEqual({ ok: false, error: 'the message failed while it was being written.' });
    expect(failed.p.announce).not.toHaveBeenCalled();

    const empty = ports({ reply: async () => ({ ok: true, error: null, reply: '  ' }) });
    expect(await sendDirect(empty.p, asker, { ask: 'it' })).toEqual({ ok: false, error: 'nothing was written in that chat.' });

    const unwritable = ports({ say: async () => Promise.reject(new Error('no')) });
    expect(await sendDirect(unwritable.p, asker, { ask: 'it' })).toEqual({ ok: false, error: 'your chat with them could not be written to.' });
    expect(unwritable.p.release).toHaveBeenCalledWith('dm-ada');

    expect((await sendDirect(ports().p, asker, {})).ok).toBe(false);
  });
});

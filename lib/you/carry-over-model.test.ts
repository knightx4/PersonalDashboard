import { describe, expect, it } from 'vitest';
import {
  CARRY_MAX_MESSAGES,
  CARRY_RULES_DIRECT,
  CARRY_RULES_GROUP,
  CARRY_TOKENS,
  carriedLines,
  carryOverText,
  type CarryChat,
  type CarryInput,
  type CarryMessage,
} from '@/lib/you/carry-over-model';
import { estimateTokens } from '@/lib/you/chat-context-model';

const BOT = 'ada';
const now = new Date('2026-11-06T15:00:00Z');
const at = (minute: number) => new Date(Date.parse('2026-11-06T12:00:00Z') + minute * 60_000).toISOString();

const direct: CarryChat = { id: 'd1', kind: 'direct' };
const group: CarryChat = { id: 'g1', kind: 'group', title: 'Weekend', memberNames: ['Ada', 'Ben'], joinedAt: at(0), leftAt: null };

function msg(id: string, chatId: string, minute: number, text: string, extra: Partial<CarryMessage> = {}): CarryMessage {
  return { id, chatId, role: 'person', speakerId: null, text, createdAt: at(minute), ...extra };
}

function input(over: Partial<CarryInput>): CarryInput {
  return { advisorId: BOT, chatId: 'here', chats: [direct, group], messages: [], episodes: [], names: new Map([['ben', 'Ben']]), ...over };
}

describe('carriedLines (plan #2983)', () => {
  it('labels each message with its chat and who said it, newest first', () => {
    const lines = carriedLines(
      input({
        messages: [
          msg('m1', 'd1', 1, 'I start the new job on Monday.'),
          msg('m2', 'd1', 2, 'Good luck with it.', { role: 'advisor' }),
          msg('m3', 'g1', 3, 'Ben here, I can help you move.', { role: 'advisor', speakerId: 'ben' }),
          msg('m4', 'g1', 4, 'Thanks, I said so to you too, Ada.', { role: 'advisor', speakerId: BOT }),
        ],
      }),
    );
    expect(lines.map((l) => [l.id, l.label, l.who])).toEqual([
      ['m4', 'group: Weekend', 'You'],
      ['m3', 'group: Weekend', 'Ben'],
      ['m2', 'one-on-one with them', 'You'],
      ['m1', 'one-on-one with them', 'They'],
    ]);
  });

  it('names an untitled group after its members', () => {
    const lines = carriedLines(input({ chats: [{ ...group, title: null }], messages: [msg('m1', 'g1', 1, 'Hello all')] }));
    expect(lines[0].label).toBe('group: Ada and Ben');
  });

  it('never repeats the thread being replied in', () => {
    const lines = carriedLines(input({ chatId: 'g1', messages: [msg('m1', 'g1', 1, 'In this group'), msg('m2', 'd1', 2, 'In private')] }));
    expect(lines.map((l) => l.id)).toEqual(['m2']);
  });

  it("leaves out groups the bot is not in, and a group's messages from before it joined or after it left", () => {
    const span: CarryChat = { ...group, joinedAt: at(10), leftAt: at(20) };
    const lines = carriedLines(
      input({
        chats: [direct, span],
        messages: [
          msg('other', 'g-other', 15, 'A group Ada is not in'),
          msg('before', 'g1', 5, 'Before Ada joined'),
          msg('during', 'g1', 15, 'While Ada was there'),
          msg('after', 'g1', 25, 'After Ada left'),
        ],
      }),
    );
    expect(lines.map((l) => l.id)).toEqual(['during']);
  });

  it('drops a message once a summarised episode holds it, and keeps what came after the summary', () => {
    const lines = carriedLines(
      input({
        messages: [msg('old', 'd1', 1, 'Summarised already'), msg('grew', 'd1', 30, 'Said after the summary'), msg('new', 'd1', 200, 'A new talk')],
        episodes: [{ chatId: 'd1', startedAt: at(0), endedAt: at(30), summarisedAt: at(10) }],
      }),
    );
    expect(lines.map((l) => l.id)).toEqual(['new', 'grew']);
  });

  it('keeps an episode with no summary carried raw', () => {
    const lines = carriedLines(input({ messages: [msg('m1', 'd1', 1, 'Not summarised')], episodes: [{ chatId: 'g1', startedAt: at(0), endedAt: at(5), summarisedAt: at(6) }] }));
    expect(lines.map((l) => l.id)).toEqual(['m1']);
  });

  it(`carries at most ${CARRY_MAX_MESSAGES} messages, the newest`, () => {
    const messages = Array.from({ length: 50 }, (_, i) => msg(`m${i}`, i % 2 ? 'd1' : 'g1', i, `Short message ${i}`));
    const lines = carriedLines(input({ messages }));
    expect(lines).toHaveLength(CARRY_MAX_MESSAGES);
    expect(lines[0].id).toBe('m49');
    expect(lines[lines.length - 1].id).toBe(`m${50 - CARRY_MAX_MESSAGES}`);
  });

  it(`stops at about ${CARRY_TOKENS} tokens with long messages`, () => {
    const messages = Array.from({ length: 20 }, (_, i) => msg(`m${i}`, 'd1', i, 'word '.repeat(400)));
    const lines = carriedLines(input({ messages }));
    expect(lines.length).toBeLessThan(20);
    expect(lines.length).toBeGreaterThan(0);
    const text = carryOverText(lines, 'group', { now, timeZone: 'UTC' });
    expect(estimateTokens(text)).toBeLessThanOrEqual(CARRY_TOKENS);
  });
});

describe('carryOverText', () => {
  it('is empty with nothing carried', () => {
    expect(carryOverText([], 'direct', { now, timeZone: 'UTC' })).toBe('');
  });

  it('dates each line and gives the rules for where the bot is replying', () => {
    const lines = carriedLines(input({ messages: [msg('m1', 'g1', 2, 'I am moving to Leeds.')] }));
    const direct = carryOverText(lines, 'direct', { now, timeZone: 'UTC' });
    expect(direct).toContain('- [group: Weekend, Fri 6 Nov 12:02] They: I am moving to Leeds.');
    expect(direct).toContain(CARRY_RULES_DIRECT);
    expect(carryOverText(lines, 'group', { now, timeZone: 'UTC' })).toContain(CARRY_RULES_GROUP);
  });
});

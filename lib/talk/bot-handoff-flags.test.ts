import { describe, expect, it } from 'vitest';
import type { FlaggedBotHandoff } from '@/lib/talk/bot-handoffs';
import { canResendHandoff, flagWhy, flaggedLines, type FlagBot } from './bot-handoff-flags';

const ZENA = 'z1';
const BOB = 'b1';
const bots: FlagBot[] = [
  { id: ZENA, key: 'zena', name: 'Zena the Researcher' },
  { id: BOB, key: 'bob', name: 'Bob Builder' },
];

function handoff(over: Partial<FlaggedBotHandoff> = {}): FlaggedBotHandoff {
  return {
    id: 'h1',
    fromBot: ZENA,
    toBot: BOB,
    sourceKind: 'direct',
    sourceId: 'c1',
    sourceLink: '/chat/people/zena',
    sourceMessageId: null,
    request: 'tell Bob to build it this way',
    packet: {},
    status: 'dropped',
    sentAt: '2026-11-06T08:00:00Z',
    pickedUpAt: null,
    doneAt: '2026-11-06T08:10:00Z',
    result: null,
    resultTable: null,
    resultId: null,
    error: 'Not picked up within 10 minutes.',
    dedupeKey: 'k',
    flaggedAt: '2026-11-06T08:10:30Z',
    ...over,
  };
}

describe('the flagged hand-offs on Dev home', () => {
  it('offers Resend for one the receiver never picked up', () => {
    const [line] = flaggedLines([handoff()], bots);
    expect(line).toMatchObject({
      route: 'Zena to Bob',
      why: "Bob didn't pick it up within 10 minutes.",
      threadHref: '/chat/people/zena',
      receiverHref: null,
      canResend: true,
      at: '2026-11-06T08:10:00Z',
    });
  });

  it('points at the receiver chat and offers no Resend for one it started on', () => {
    const [line] = flaggedLines([handoff({ pickedUpAt: '2026-11-06T08:01:00Z' })], bots);
    expect(line.why).toBe("Bob started but didn't finish within 10 minutes.");
    expect(line.receiverHref).toBe('/chat/people/bob');
    expect(line.canResend).toBe(false);
  });

  it('gives a failure its error, and never resends one to Ask Dash', () => {
    const failed = handoff({ status: 'failed', toBot: null, error: 'Ask Dash does not take requests from the bots yet.' });
    const [line] = flaggedLines([failed], bots);
    expect(line.route).toBe('Zena to Dash');
    expect(line.why).toBe('Ask Dash does not take requests from the bots yet.');
    expect(line.canResend).toBe(false);
    expect(flagWhy({ status: 'failed', pickedUpAt: null, error: 'Bob cannot talk yet' }, 'Bob')).toBe('Bob cannot talk yet.');
    expect(flagWhy({ status: 'failed', pickedUpAt: null, error: null }, 'Bob')).toBe("Bob couldn't take it on.");
  });

  it('names a bot no longer on People, and Ask Dash as the sender', () => {
    const [line] = flaggedLines([handoff({ fromBot: null, toBot: 'gone' })], bots);
    expect(line.route).toBe('Dash to Someone on People');
  });

  it('refuses a resend for a hand-off still open', () => {
    expect(canResendHandoff({ status: 'sent', pickedUpAt: null, toBot: BOB })).toBe(false);
  });
});

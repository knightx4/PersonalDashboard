import type { FlaggedBotHandoff } from '@/lib/talk/bot-handoffs';
import { quoteRequest } from '@/lib/you/bot-handoff-reply';
import { firstName } from '@/lib/you/group-chats-model';

/**
 * Dev home's list of bot hand-offs that failed or went unanswered (plan
 * #3003.4). The watch (core.watch_bot_handoffs, migration 0310) drops a
 * hand-off not done 10 minutes after it was sent and flags every failure in
 * the thread it was asked in; this turns those rows into the lines Home
 * shows, each with the thread to open and, when it is safe, a Resend.
 *
 * Resend is offered only when the receiver never picked the hand-off up and
 * it went to a bot rather than Ask Dash, the same rule
 * core.resend_bot_handoff keeps, so nothing the receiver did is done twice.
 */

/** Someone on People, as the list names them. */
export type FlagBot = { id: string; key: string; name: string };

export type FlaggedLine = {
  id: string;
  /** The person's words, cut for one line. */
  request: string;
  /** "Zena to Bob". */
  route: string;
  /** What went wrong, in a short sentence. */
  why: string;
  /** When it ended. */
  at: string;
  /** The thread it was asked in. */
  threadHref: string;
  /** The receiver's own chat, for one it started on. */
  receiverHref: string | null;
  receiverName: string;
  canResend: boolean;
};

/** The name a bot goes by in a line: Dash for null, "Someone on People" for one gone. */
export function botName(id: string | null, bots: ReadonlyMap<string, FlagBot>): string {
  if (id === null) return 'Dash';
  const bot = bots.get(id);
  return bot ? firstName(bot.name) || bot.name : 'Someone on People';
}

/** True when Resend may put it back: never picked up, and passed to a bot. */
export function canResendHandoff(handoff: Pick<FlaggedBotHandoff, 'status' | 'pickedUpAt' | 'toBot'>): boolean {
  return (handoff.status === 'failed' || handoff.status === 'dropped') && handoff.pickedUpAt === null && handoff.toBot !== null;
}

/** What went wrong, as the line says it. */
export function flagWhy(handoff: Pick<FlaggedBotHandoff, 'status' | 'pickedUpAt' | 'error'>, receiver: string): string {
  if (handoff.status === 'dropped') {
    return handoff.pickedUpAt === null
      ? `${receiver} didn't pick it up within 10 minutes.`
      : `${receiver} started but didn't finish within 10 minutes.`;
  }
  const error = (handoff.error ?? '').replace(/\s+/g, ' ').trim();
  if (!error) return `${receiver} couldn't take it on.`;
  return /[.!?]$/.test(error) ? error : `${error}.`;
}

export function flaggedLines(handoffs: readonly FlaggedBotHandoff[], bots: readonly FlagBot[]): FlaggedLine[] {
  const byId = new Map(bots.map((bot) => [bot.id, bot]));
  return handoffs.map((handoff) => {
    const receiverName = botName(handoff.toBot, byId);
    const receiver = handoff.toBot ? byId.get(handoff.toBot) : undefined;
    return {
      id: handoff.id,
      request: quoteRequest(handoff.request),
      route: `${botName(handoff.fromBot, byId)} to ${receiverName}`,
      why: flagWhy(handoff, receiverName),
      at: handoff.doneAt ?? handoff.flaggedAt,
      threadHref: handoff.sourceLink,
      receiverHref:
        handoff.pickedUpAt !== null && receiver ? `/chat/people/${encodeURIComponent(receiver.key)}` : null,
      receiverName,
      canResend: canResendHandoff(handoff),
    };
  });
}

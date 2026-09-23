import { localPartOf } from '@/lib/news/address';
import type { InboundMessage } from '@/lib/news/providers/types';
import type { NewsStore } from './store';

/**
 * What became of one delivery.
 *
 * `stored` carries the account and the new issue's id, which is what the
 * inbound route needs to summarise the issue once it has answered.
 *
 * `unaddressed` is not an error. Mail arrives at this domain addressed to
 * names nobody has ever held -- a guess, a harvested list, an address that was
 * replaced -- and the answer to all of it is to drop the message and tell the
 * service everything is fine. A bounce would answer the one question the
 * sender wanted answered, which is whether the address exists.
 */
export type Delivery =
  | { status: 'stored'; userId: string; issueId: string }
  | { status: 'repeat' }
  | { status: 'unaddressed' };

/**
 * Store one message, or decide not to.
 *
 * The order matters: the account is resolved before anything is written, so a
 * message to an address nobody owns leaves no sender row behind either.
 */
export async function deliver(
  store: NewsStore,
  message: InboundMessage,
  domain: string,
): Promise<Delivery> {
  const localPart = localPartOf(message.recipient, domain);
  if (!localPart) return { status: 'unaddressed' };

  const userId = await store.accountFor(localPart);
  if (!userId) return { status: 'unaddressed' };

  const senderId = await store.senderFor(userId, message.senderEmail, message.senderName);
  const stored = await store.storeIssue({ userId, senderId, message });
  if (stored === 'repeat') return { status: 'repeat' };
  return { status: 'stored', userId, issueId: stored.issueId };
}

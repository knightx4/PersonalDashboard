import type { ChipTone } from '@/components/ui/chip';
import type { FeedbackKind } from '@/lib/feedback/load';

/**
 * The kind's chip. A bug is danger and a request accent, as they always
 * were; a like is positive, since it reports something that works. Its own
 * file so the client list and the server-rendered list of other accounts'
 * notes read one table.
 */
export const KIND_TONE: Record<FeedbackKind, ChipTone> = {
  bug: 'danger',
  feature: 'accent',
  like: 'positive',
};

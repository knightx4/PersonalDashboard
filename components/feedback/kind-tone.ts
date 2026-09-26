import type { FeedbackKind } from '@/lib/feedback/load';

/**
 * The kind's lozenge. A bug is danger and a request accent, as they always
 * were; a like is positive, since it reports something that works. Its own
 * file so the client list and the server-rendered list of other accounts'
 * notes read one table.
 */
export const KIND_TONE: Record<FeedbackKind, string> = {
  bug: 'bg-danger-tint text-danger',
  feature: 'bg-accent-tint text-accent',
  like: 'bg-positive-tint text-positive',
};

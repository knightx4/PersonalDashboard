import { ThreadPanel } from '@/components/patterns/thread';
import { Thread } from '@/components/thread/thread';
import type { DevComment } from '@/lib/comments/load';
import { threadRef } from '@/lib/thread/subjects';

/**
 * The chat with Dash on a reading's Summary tab (plan #1876.5), in the thread
 * pattern. Everything written here is a question for Dash, answered from the
 * reading's text and its summary before the send returns
 * (addReadingComment). The thread is the row thread under the reading, so it
 * is there again on the next visit.
 */
export function ReadingChat({
  readingId,
  turns,
  awaitingReply = false,
  composerOpen = false,
}: {
  readingId: string;
  turns: readonly DevComment[];
  /** Gallery only: draw the line shown while Dash writes. */
  awaitingReply?: boolean;
  /** Gallery only: draw the box open. */
  composerOpen?: boolean;
}) {
  return (
    <ThreadPanel title="Ask Dash about this reading" className="mb-5">
      <Thread
        subject={threadRef('reading', readingId)}
        turns={turns}
        label={turns.length === 0 ? 'Ask a question' : 'Ask another question'}
        placeholder="A question about this reading. Dash answers from its text."
        awaitingReply={awaitingReply}
        composerOpen={composerOpen}
        onCard
      />
    </ThreadPanel>
  );
}

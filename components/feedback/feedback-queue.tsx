import { MessageSquarePlus } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { FeedbackList } from '@/app/shopping/feedback/feedback-list';
import { RunRoutineButton } from '@/components/feedback/run-routine-button';
import type { FeedbackQueue } from '@/lib/feedback/load';

/**
 * The queue itself, without a page header.
 *
 * Both workspaces show the same list — there is one queue — and they differ
 * only in which shell's header sits above it, so that is the only thing each
 * page supplies.
 */
export function FeedbackQueueView({ queue }: { queue: FeedbackQueue }) {
  const { rows, outstanding, closed, blocked } = queue;

  if (rows.length === 0) {
    return (
      <div className="space-y-6">
        <EmptyState
          icon={MessageSquarePlus}
          title="Nothing captured yet"
          description="Use the message button in the header to log a bug or an idea the moment you hit it."
        />
        <RunRoutineButton />
      </div>
    );
  }

  return (
    <>
      {blocked.length > 0 && (
        <p className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-ui text-ink">
          {blocked.length} note(s) blocked, waiting on an answer from you. They are listed
          first below with the question.
        </p>
      )}

      <div className="space-y-6">
        {outstanding.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-body font-semibold text-ink">
              Outstanding <span className="font-normal text-ink-muted">({outstanding.length})</span>
            </h2>
            <FeedbackList rows={outstanding} />
          </section>
        )}
        {closed.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-body font-semibold text-ink">
              Closed <span className="font-normal text-ink-muted">({closed.length})</span>
            </h2>
            <FeedbackList rows={closed} />
          </section>
        )}

        {/* Under the whole list: the queue is what the routine works. */}
        <RunRoutineButton />
      </div>
    </>
  );
}

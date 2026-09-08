import { MessageSquarePlus } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { FeedbackList } from '@/components/feedback/feedback-list';
import { RunRoutineButton } from '@/components/feedback/run-routine-button';
import type { FeedbackQueue } from '@/lib/feedback/load';

/**
 * The queue itself, without a page header.
 *
 * It lives apart from the page for the reason it always did: there is one
 * queue, and it used to be rendered under two workspaces that differed only in
 * which shell sat above it. Both of those are redirects to /dev/bugs now, and
 * this stays split because a queue view and a page are still different things.
 */
export function FeedbackQueueView({ queue }: { queue: FeedbackQueue }) {
  const { rows, outstanding, closed, blocked } = queue;

  if (rows.length === 0) {
    return (
      <div className="space-y-6">
        {/* No `action`: the thing that fills this is the message button in the
            header, which is a popover rather than a place, and a link that
            only says "look up" would be worse than none. */}
        <EmptyState
          icon={MessageSquarePlus}
          title="Nothing captured yet"
          description="Use the message button in the header to log a bug or an idea the moment you hit it."
        />
        <RunRoutineButton openCount={0} divider="bottom" />
      </div>
    );
  }

  return (
    <>
      {/* First, not last. It was under the whole list, which meant scrolling
          past every note to reach the button that works them -- and the count
          beside it already says what scrolling would have told you. */}
      <div className="mb-6">
        <RunRoutineButton openCount={outstanding.length} divider="bottom" />
      </div>

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
      </div>
    </>
  );
}

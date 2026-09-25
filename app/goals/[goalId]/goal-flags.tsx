'use client';

import { useActionState } from 'react';
import { CommentThread, type CommentStore } from '@/components/dev/comment-thread';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FieldError } from '@/components/ui/field';
import type { GoalFlag } from '@/lib/goals/flags';
import {
  answerFlagAction,
  deleteFlagCommentAction,
  dismissFlagAction,
  type FlagActionState,
} from './flag-actions';

/**
 * What Claude flagged on this goal (plan #1015): something a run found that
 * is neither a step nor a question, such as a moved due date. Each one shows
 * what was found, the thread under it, and a box to answer it. An answer
 * starts a goal run with the answer in its brief, and the run replies in the
 * thread and closes the flag. An open one can also be put aside unanswered.
 */

const FLAG_STORE: CommentStore = {
  add: answerFlagAction,
  remove: deleteFlagCommentAction,
  // Never shown: the box always writes through `submit` below, which draws no
  // cost hint. An answer starts a routine run rather than a priced model call.
  paid: 'app/goals/[goalId]/comment-actions.ts#addGoalComment',
};

export function GoalFlags({ flags }: { flags: GoalFlag[] }) {
  return (
    <section aria-labelledby="flags-heading" className="space-y-2">
      <h2 id="flags-heading" className="px-1 text-ui font-semibold text-ink">
        Claude flagged
      </h2>
      {flags.map((flag) => (
        <FlagCard key={flag.id} flag={flag} />
      ))}
    </section>
  );
}

function FlagCard({ flag }: { flag: GoalFlag }) {
  const [state, dismiss, dismissing] = useActionState(dismissFlagAction, {} as FlagActionState);
  const open = flag.status === 'open';
  return (
    <Card id={`flag-${flag.id}`} padding="dense" className="scroll-mt-4 space-y-2">
      <div className="space-y-1">
        <p className="text-ui font-medium break-words text-ink">{flag.title}</p>
        {flag.detail && (
          <p className="text-small break-words whitespace-pre-line text-ink-muted">{flag.detail}</p>
        )}
        {flag.ask && <p className="text-small break-words text-ink">{flag.ask}</p>}
        {!open && (
          <p className="text-small text-ink-muted">Answered. Claude closes it once it has acted on your answer.</p>
        )}
      </div>
      <CommentThread
        target="raise"
        id={flag.id}
        thread={flag.thread}
        store={FLAG_STORE}
        submit={{ action: answerFlagAction, label: open ? 'Answer' : 'Say more' }}
        placeholder="Your answer. Claude acts on it and replies here."
      />
      {open && (
        <form action={dismiss} className="flex items-center gap-2">
          <input type="hidden" name="id" value={flag.id} />
          <Button type="submit" size="sm" variant="ghost" pending={dismissing}>
            Put aside
          </Button>
          <FieldError>{state.error}</FieldError>
        </form>
      )}
    </Card>
  );
}

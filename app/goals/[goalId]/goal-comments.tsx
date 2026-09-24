'use client';

import { CommentThread, type CommentStore } from '@/components/dev/comment-thread';
import type { DevComment } from '@/lib/comments/load';
import { addGoalComment, deleteGoalComment } from './comment-actions';

/**
 * The thread on a goal or a step (plan #957): the dev plan's thread, posting
 * to goals.comments instead of dev_comments. Tagging @dash gets a reply from
 * the goal written out, and facts it gives can be filed into a collection as
 * drafts.
 */
const GOALS_STORE: CommentStore = {
  add: addGoalComment,
  remove: deleteGoalComment,
  paid: 'app/goals/[goalId]/comment-actions.ts#addGoalComment',
};

export function GoalThread({
  itemId,
  thread,
  label,
  placeholder,
}: {
  /** The goal or step the thread is on. */
  itemId: string;
  thread: readonly DevComment[];
  label?: string;
  placeholder: string;
}) {
  return (
    <CommentThread
      target="goal"
      id={itemId}
      thread={thread}
      label={label}
      placeholder={placeholder}
      store={GOALS_STORE}
    />
  );
}

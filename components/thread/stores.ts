import { addComment, deleteComment, type CommentActionState } from '@/app/dev/comment-actions';
import { addGoalComment, deleteGoalComment } from '@/app/goals/[goalId]/comment-actions';
import { addFileComment, deleteFileCommentAction } from '@/app/goals/files/[fileId]/comment-actions';
import { addRoleComment, deleteRoleComment } from '@/app/jobs/(app)/roles/[id]/comment-actions';
import type { PaidAction } from '@/lib/core/spend/paid-actions';
import type { ThreadTarget } from '@/lib/thread/subjects';

/** A server action the thread's forms post to. */
export type ThreadAction = (
  prev: CommentActionState,
  formData: FormData,
) => Promise<CommentActionState>;

/**
 * Where a thread's turns are written, and what a reply there costs.
 *
 * Each of the six surfaces still writes to its own table until plan #1470
 * copies them into core.conversations; this is the one place that says which.
 * When that lands, every target here points at the same pair of actions and
 * the map goes.
 */
export type CommentStore = {
  add: ThreadAction;
  remove: ThreadAction;
  /** The action key the cost hint on a tagged comment prices. */
  paid: PaidAction;
};

/** dev_comments: ideas, plan steps, raises, bug notes, spec sections, takeaways, spec changes. */
const DEV_STORE: CommentStore = {
  add: addComment,
  remove: deleteComment,
  paid: 'app/dev/comment-actions.ts#addComment',
};

/** goals.comments, for every signed-in account rather than the owner alone (plan #957). */
const GOALS_STORE: CommentStore = {
  add: addGoalComment,
  remove: deleteGoalComment,
  paid: 'app/goals/[goalId]/comment-actions.ts#addGoalComment',
};

/** A role's notes, with Dash's replies among them (note 89ad8bef). */
const ROLE_STORE: CommentStore = {
  add: addRoleComment,
  remove: deleteRoleComment,
  paid: 'app/jobs/(app)/roles/[id]/comment-actions.ts#addRoleComment',
};

/** core.file_comments. No reply is paid for here, since Dash does not answer in it. */
const FILES_STORE: CommentStore = {
  add: addFileComment,
  remove: deleteFileCommentAction,
  paid: 'app/goals/[goalId]/comment-actions.ts#addGoalComment',
};

export const THREAD_STORES: Record<ThreadTarget, CommentStore> = {
  idea: DEV_STORE,
  step: DEV_STORE,
  raise: DEV_STORE,
  note: DEV_STORE,
  spec: DEV_STORE,
  takeaway: DEV_STORE,
  change: DEV_STORE,
  goal: GOALS_STORE,
  role: ROLE_STORE,
  file: FILES_STORE,
};

'use client';

import { CommentThread, type CommentStore } from '@/components/dev/comment-thread';
import type { DevComment } from '@/lib/comments/load';
import { addFileComment, deleteFileCommentAction } from './comment-actions';

/** Where a file's thread is kept (note 7a6a37aa). No reply is paid for here, since Dash does not answer in it. */
const FILES_STORE: CommentStore = {
  add: addFileComment,
  remove: deleteFileCommentAction,
  paid: 'app/goals/[goalId]/comment-actions.ts#addGoalComment',
};

/** The thread under a file: notes on it, read by the goals run before it revises the file. */
export function FileThread({ fileId, thread }: { fileId: string; thread: readonly DevComment[] }) {
  return (
    <CommentThread
      target="file"
      id={fileId}
      thread={thread}
      placeholder="What you think of this file, or what it should change."
      store={FILES_STORE}
    />
  );
}

'use client';

import { CommentThread, type CommentStore } from '@/components/dev/comment-thread';
import type { DevComment } from '@/lib/comments/load';
import { addRoleComment, deleteRoleComment } from './comment-actions';

/** Where a role's thread is kept: its notes, with Dash's replies among them (note 89ad8bef). */
const ROLE_STORE: CommentStore = {
  add: addRoleComment,
  remove: deleteRoleComment,
  paid: 'app/jobs/(app)/roles/[id]/comment-actions.ts#addRoleComment',
};

/**
 * The comment thread on a role, in place of the Notes tab. Untagged, a
 * comment is a note to yourself; tagged @dash, Dash answers from the role,
 * its description and your evidence bank, and "@dash write my cover letter"
 * writes one into the Application tab.
 */
export function RoleThread({ roleId, thread }: { roleId: string; thread: readonly DevComment[] }) {
  return (
    <CommentThread
      target="role"
      id={roleId}
      thread={thread}
      placeholder="Anything worth remembering about this role, or @dash write my cover letter."
      store={ROLE_STORE}
    />
  );
}

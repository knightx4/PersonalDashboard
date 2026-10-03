import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { emptyLinkerCounters, type DomainLinker } from '@/lib/core/inbox/fan-out';
import { recordScheduled } from '@/lib/core/scheduled-actions';
import { JEV_CONFIDENCE_FLOOR } from '@/lib/jev/decide';
import { jevEnabledFor } from '@/lib/jev/enabled';
import type { TodoSupabaseClient } from '@/lib/todo/db/schema-name';
import {
  REPLY_WINDOW_DAYS,
  replyTaskBody,
  replyTaskTitle,
  skipReason,
  type ReplyCandidate,
} from './task';

/**
 * Emails waiting on the person's answer, filed as Todo tasks (plan #1180).
 *
 * Reads the mailroom's needs_reply pile (core.mail_piles), so it runs after
 * the mailroom in the fan-out. It does not look at the page it is offered:
 * todo.reply_candidates returns the newest message of every thread Jev is
 * sure about, from the last two weeks, that has not been judged, and
 * todo.file_reply_task records each thread before it files the task, so a
 * thread gets one task however many of its messages arrive.
 *
 * It claims nothing and fetches no bodies. For an account that has not agreed
 * to Jev there is no pile to read, so it does nothing.
 *
 * Each task it files is recorded as Dash's for Home (plan #1577), with an
 * Undo that removes the task. The thread stays judged, so an undone task is
 * not filed again on the next pass.
 */

/** The sentence Home reads for a reply task. */
export function replyTaskSummary(title: string): string {
  return `Dash added "${title}" to Todo, for an email waiting on your answer.`;
}

/** Threads filed in one pass at most. */
const FILE_LIMIT = 20;

export async function fileReplyTasks(
  todo: Pick<TodoSupabaseClient, 'rpc'>,
  opts: { userId: string; now?: number },
): Promise<{ filed: number; skipped: number }> {
  const since = new Date((opts.now ?? Date.now()) - REPLY_WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await todo.rpc('reply_candidates', {
    p_user_id: opts.userId,
    p_floor: JEV_CONFIDENCE_FLOOR,
    p_since: since,
    p_limit: FILE_LIMIT,
  });
  if (error) throw new Error(`reply candidates failed: ${error.message}`);

  let filed = 0;
  let skipped = 0;
  for (const candidate of (data ?? []) as ReplyCandidate[]) {
    const skip = skipReason(candidate);
    const { data: taskId, error: fileError } = await todo.rpc('file_reply_task', {
      p_user_id: opts.userId,
      p_message_id: candidate.message_id,
      p_title: skip ? null : replyTaskTitle(candidate),
      p_body: skip ? null : replyTaskBody(candidate),
    });
    if (fileError) throw new Error(`reply task failed: ${fileError.message}`);
    if (taskId) {
      filed += 1;
      await recordScheduled(todo, opts.userId, {
        kind: 'file_reply_task',
        subjectRef: `todo.tasks:${taskId as string}`,
        op: 'insert',
        summary: replyTaskSummary(replyTaskTitle(candidate)),
      });
    } else skipped += 1;
  }
  return { filed, skipped };
}

export function replyLinker(todo: TodoSupabaseClient, core: CoreSupabaseClient): DomainLinker {
  return {
    domain: 'replies',

    async link({ userId, envelopes }) {
      const counters = emptyLinkerCounters();
      counters.offered = envelopes.length;
      if (envelopes.length === 0) return counters;
      if (!(await jevEnabledFor(core, userId))) return counters;
      const { filed } = await fileReplyTasks(todo, { userId });
      counters.linked = filed;
      return counters;
    },

    // The mailroom's sweep sorts older mail after the pages are read, so a
    // reply it finds there is filed on this pass rather than the next sync's.
    async sweep({ userId }) {
      if (!(await jevEnabledFor(core, userId))) return;
      await fileReplyTasks(todo, { userId });
    },
  };
}

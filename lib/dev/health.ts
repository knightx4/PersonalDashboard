/**
 * What each dev queue's row actually means right now.
 *
 * The plan has worked this way for a while: `status` is what somebody set, and
 * `healthOf` in lib/plan/tree.ts turns it plus everything else true of the row
 * into the one word the page shows. The other four queues printed their column.
 * So a note stopped on a question you have not answered and a note parked
 * because the build plan has it were both "blocked" and "planned" -- two raw
 * enum values that say where a row was filed, not what it is waiting for.
 *
 * One function per queue, all pure, all taking the row rather than the status:
 * the extra facts are the point. A blocked note whose thread you have replied
 * to is not waiting on you any more. A raise answered with nothing recorded as
 * coming of it is not finished. An idea shaped into a proposal nobody has
 * approved is waiting on you, even though the idea itself is untouched.
 *
 * The health names reuse lib/dev/words.ts wherever the state is one every queue
 * has, so the words and the shapes carry over without a second mapping.
 */

import type { DevComment } from '@/lib/comments/load';
import type { FeedbackRow } from '@/lib/feedback/load';
import type { IdeaRow } from '@/lib/ideas/load';
import type { RaisedRow } from '@/lib/raised/load';
import type { UiFinding } from '@/lib/ui-review/load';

/**
 * Whether the last thing said on a row was said by the person.
 *
 * A session asks its question in the thread and stops. Until you reply, the row
 * is waiting on you; once you have, it is waiting on a session again -- and
 * nothing in any status column moves when you type. This is the fact that tells
 * the two apart.
 */
export function lastWordIsYours(thread: readonly DevComment[]): boolean {
  return thread.length > 0 && thread[thread.length - 1].author === 'me';
}

/** The seven states a note in the bugs queue can be read as. */
export const FEEDBACK_HEALTHS = [
  'waiting',
  'answered',
  'ready',
  'planned',
  'working',
  'done',
  'dropped',
] as const;

export type FeedbackHealth = (typeof FEEDBACK_HEALTHS)[number];

/**
 * A note, read rather than printed.
 *
 * `blocked` splits in two. A note blocked with the last word in its thread
 * yours is answered: the session that stopped can carry on, and leaving it in
 * the "waiting on you" pile is the page asking you for something you have
 * already given it. Blocked with nothing said back is the real one.
 *
 * `planned` stays its own state rather than folding into ready. The note is not
 * waiting on you and nobody is on it: it was written into the build plan and
 * what happens to it happens there.
 */
export function feedbackHealth(
  row: Pick<FeedbackRow, 'status' | 'thread'>,
): FeedbackHealth {
  switch (row.status) {
    case 'blocked':
      return lastWordIsYours(row.thread) ? 'answered' : 'waiting';
    case 'open':
      return 'ready';
    case 'planned':
      return 'planned';
    case 'in_progress':
      return 'working';
    case 'done':
      return 'done';
    case 'declined':
      return 'dropped';
  }
}

/** The five states a raise can be read as. */
export const RAISED_HEALTHS = [
  'waiting',
  'unfinished',
  'answered',
  'closed',
  'dropped',
] as const;

export type RaisedHealth = (typeof RAISED_HEALTHS)[number];

/**
 * A raise, read rather than printed.
 *
 * `answered` splits on whether anything came of it. A raise reaching answered
 * with no outcome recorded is the #342 failure -- answered yes and closed while
 * the thing it described was still possible -- so it is its own state and the
 * page already lists those rows apart from the closed ones. This is where that
 * rule lives now, rather than only in the grouping.
 *
 * `answered` and `closed` are two states rather than one because replying is
 * not being finished: a yes that files an idea leaves work behind it, and the
 * person is the one who says they have read what came of it. 0073 added the
 * column value; this is what the page reads it as.
 */
export function raisedHealth(row: Pick<RaisedRow, 'status' | 'outcome'>): RaisedHealth {
  switch (row.status) {
    case 'open':
      return 'waiting';
    case 'answered':
      return row.outcome ? 'answered' : 'unfinished';
    case 'closed':
      return 'closed';
    case 'dismissed':
      return 'dropped';
  }
}

/** The three states a UI finding can be read as. */
export const FINDING_HEALTHS = ['waiting', 'ready', 'dropped'] as const;

export type FindingHealth = (typeof FINDING_HEALTHS)[number];

/**
 * A finding, read rather than printed.
 *
 * The one queue where the reading is the column: a pass files a candidate, you
 * confirm it or dismiss it, and nothing else is true of the row. It is a
 * function anyway so the page prints no column of its own, and so that the day
 * a finding learns whether it was fixed there is somewhere for that to go.
 */
export function findingHealth(finding: Pick<UiFinding, 'status'>): FindingHealth {
  switch (finding.status) {
    case 'open':
      return 'waiting';
    case 'confirmed':
      return 'ready';
    case 'dismissed':
      return 'dropped';
  }
}

/** The five states an idea can be read as. */
export const IDEA_HEALTHS = ['open', 'waiting', 'shaped', 'done', 'dropped'] as const;

export type IdeaHealth = (typeof IDEA_HEALTHS)[number];

/**
 * An idea, read through the plan row it became.
 *
 * A shaped idea is not one state. The proposal a session wrote is waiting on
 * you to approve it, the approved feature is being built somewhere else, and
 * the finished one is finished -- and the ideas page said "in the plan" to all
 * three. Which it is is on the plan row, which the loader already fetches.
 */
export function ideaHealth(
  idea: Pick<IdeaRow, 'dismissedAt' | 'planItem'>,
): IdeaHealth {
  if (idea.dismissedAt) return 'dropped';
  if (!idea.planItem) return 'open';
  if (idea.planItem.status === 'proposed') return 'waiting';
  return idea.planItem.status === 'done' ? 'done' : 'shaped';
}

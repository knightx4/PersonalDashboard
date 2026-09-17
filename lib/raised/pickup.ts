/**
 * What happens when you answer a raise.
 *
 * A raise is a question a session asked you, and answering it used to be the
 * end of the exchange: the answer went into the thread and nothing read it
 * until somebody happened to start a session and run `plan.ts raises`. Two of
 * them sat with an answer on them for five and six days that way.
 *
 * So the answer starts the run itself. The plan routine is fired with the
 * raise, everything said on it and what you wrote, and it does what the answer
 * says, replies in the thread and closes the raise when there is nothing left
 * in it. Same machinery as a question asked on a row — lib/comments/ask.ts —
 * and it skips the fast reply on purpose: an answer is nearly always a piece of
 * work, and a model call that can only write a sentence back would spend a
 * round finding that out.
 */
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { raiseContext, threadText } from '@/lib/comments/context';
import { planRoutine } from '@/lib/feedback/routine';
import { startRoutineRun } from '@/lib/plan/runs';
import { raisedRowFrom, RAISED_COLUMNS, type RaisedRow } from './load';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public'>;

export type PickupOutcome =
  | { ok: true; message: string }
  /** Nothing was started, and `said` is null when there is nothing to report. */
  | { ok: false; said: string | null };

export type PickupInput = {
  supabase: Db;
  userId: string;
  /** The raise the answer was written on. */
  id: string;
  /** The comment carrying the answer, left out of the history. */
  commentId: string;
  answer: string;
};

/**
 * What the run may do, said in the turn because the skill cannot say it per
 * raise.
 *
 * The three moves that stay the person's are the ones that stay theirs
 * everywhere — see lib/comments/ask.ts, which words this for a comment on a
 * row. Closing is not one of them any more: 0073 added the state for a raise
 * that is finished with, and a run that has done what the answer asked for is
 * the thing that knows it is finished.
 */
const ANSWER_RULE =
  'The answer is what to build against, so do what it says rather than describe it, and then ' +
  'write into the thread what you did. If it is code, commit it. If it is too large to finish ' +
  'in this run, file it as a plan step or an idea and say in the thread where it now lives. Do ' +
  'not write back that you cannot: you have the repository, the plan and the notes queue in ' +
  'front of you. Three moves stay theirs however the answer is phrased -- approving a proposal, ' +
  'answering a question put to them, and deleting anything -- and asked for one of those, ' +
  'change nothing and say in the thread where on the page it is made. Close the raise once ' +
  'there is nothing left in it, with the update below, and leave it open if what the answer ' +
  'asked for is still outstanding.';

/** The turn the run is started with: the raise, the thread, and the answer. */
export function pickupTurn(input: {
  userId: string;
  row: RaisedRow;
  /** The thread with the comment carrying the answer taken out. */
  history: readonly RaisedRow['thread'][number][];
  answer: string;
}): string {
  const said = threadText(input.history);
  return (
    'Pick up a raise the person has answered, in the app. Read the code it is about, do what ' +
    'the answer says, and write into the thread on that raise what you did.\n\n' +
    `${raiseContext(input.row).trimEnd()}\n\n` +
    (said ? `${said.trimEnd()}\n\n` : '') +
    `## Their answer\n\n${input.answer}\n\n` +
    '## Where what you did goes\n\n' +
    "insert into dev_comments (user_id, raised_item_id, author, body) values " +
    `('${input.userId}', '${input.row.id}', 'claude', '<what you did>');\n\n` +
    '## Closing it, once there is nothing left in it\n\n' +
    "update raised_items set status = 'closed' where id = " +
    `'${input.row.id}' and user_id = '${input.userId}';\n\n` +
    ANSWER_RULE
  );
}

/**
 * Start the run, when the raise is one an answer means something on.
 *
 * A comment on a closed or dismissed raise is a note on something finished, so
 * it starts nothing and says nothing — the same quiet an untagged comment on
 * any other row gets. A raise that still wants something is the case this is
 * for, open or answered alike: an answer on an open one is you answering it,
 * and one on an answered one is you saying more about an answer already given.
 */
export async function pickUpRaise(input: PickupInput): Promise<PickupOutcome> {
  const { data } = await input.supabase
    .from('raised_items')
    .select(RAISED_COLUMNS)
    .eq('user_id', input.userId)
    .eq('id', input.id)
    .maybeSingle();
  if (!data) return { ok: false, said: null };

  const row = raisedRowFrom(data as unknown as Record<string, unknown>);
  if (row.status !== 'open' && row.status !== 'answered') return { ok: false, said: null };

  const history = row.thread.filter((comment) => comment.id !== input.commentId);
  const started = await startRoutineRun({
    supabase: input.supabase,
    userId: input.userId,
    job: 'raise',
    routine: planRoutine(),
    // A raise is not a plan row, so there is no step for the run to name.
    planItemId: null,
    text: pickupTurn({ userId: input.userId, row, history, answer: input.answer }),
  });

  if (!started.ok) {
    return { ok: false, said: `Your answer is saved, but no session started: ${started.error}` };
  }
  return { ok: true, message: 'A session is reading the code. What it did lands in this thread.' };
}

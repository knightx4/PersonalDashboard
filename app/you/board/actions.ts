'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { boardRoutine } from '@/lib/feedback/routine';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createTask } from '@/lib/todo/tasks/write';
import { createYouClient } from '@/lib/you/auth/server';
import { callBoardMeeting } from '@/lib/you/board-start';
import {
  ANSWER_MAX,
  clearBoardMark,
  loadBoardMeeting,
  meetingTitle,
  NOTE_MAX,
  plainText,
  saveBoardMark,
  VOTE_VALUES,
  type BoardMark,
  type VoteValue,
} from '@/lib/you/board';

/**
 * The person's marks on the board's minutes (plan #2540.3): a vote on each
 * disagreement, the answer to the question, and each resolution ticked or
 * made a todo. Each saves the moment it is made, and the next meeting reads
 * them first (.claude/skills/board/SKILL.md).
 *
 * Every action reads the meeting under the signed-in person first, so a mark
 * can only name a meeting of theirs and an item its minutes hold.
 */

export type BoardMarkResult = { error: string | null; saved?: BoardMark | null };

const meetingId = z.string().uuid();

async function meetingFor(id: string) {
  if (!meetingId.safeParse(id).success) return { error: 'That is not a board meeting.' } as const;
  const user = await requireUser();
  const client = await createYouClient();
  const found = await loadBoardMeeting(client, user.id, id);
  if (!found) return { error: 'That board meeting is not yours or no longer exists.' } as const;
  if (found.meeting.status !== 'ready')
    return { error: 'This meeting has no minutes to mark yet.' } as const;
  return { user, client, ...found } as const;
}

const failed = (error: unknown, fallback: string): BoardMarkResult => ({
  error: error instanceof Error ? error.message : fallback,
});

/** Side with one seat on a disagreement, or with neither, with an optional line of why. */
// latency: pending
export async function voteOnDisagreement(
  id: string,
  item: string,
  value: VoteValue,
  note?: string | null,
): Promise<BoardMarkResult> {
  if (!(VOTE_VALUES as readonly string[]).includes(value)) return { error: 'That is not a seat.' };
  if (note && note.length > NOTE_MAX) return { error: 'A note holds at most 2,000 characters.' };
  try {
    const found = await meetingFor(id);
    if ('error' in found) return { error: found.error ?? null };
    const disagreement = found.minutes.disagreements.find((d) => d.key === item);
    if (!disagreement) return { error: 'That disagreement is not in these minutes.' };
    if (value !== 'neither' && !disagreement.positions.some((p) => p.seat === value)) {
      return { error: 'That seat took no side on this point.' };
    }
    const saved = await saveBoardMark(found.client, found.user.id, id, {
      kind: 'vote',
      item,
      value,
      note: note ?? null,
    });
    revalidatePath('/you/board');
    return { error: null, saved };
  } catch (error) {
    return failed(error, 'Your vote was not saved. Try again.');
  }
}

/** Their answer to the meeting's one question. A blank answer takes it off. */
// latency: pending
export async function answerBoardQuestion(id: string, answer: string): Promise<BoardMarkResult> {
  if (answer.length > ANSWER_MAX) return { error: 'An answer holds at most 4,000 characters.' };
  try {
    const found = await meetingFor(id);
    if ('error' in found) return { error: found.error ?? null };
    if (!found.minutes.question) return { error: 'This meeting asked no question.' };
    if (!answer.trim()) {
      await clearBoardMark(found.client, found.user.id, id, 'answer', 'question');
      revalidatePath('/you/board');
      return { error: null, saved: null };
    }
    const saved = await saveBoardMark(found.client, found.user.id, id, {
      kind: 'answer',
      item: 'question',
      value: answer,
    });
    revalidatePath('/you/board');
    return { error: null, saved };
  } catch (error) {
    return failed(error, 'Your answer was not saved. Try again.');
  }
}

/** Tick a resolution done, or untick it back to open. A todo made from it stays linked. */
// latency: pending
export async function markResolution(
  id: string,
  item: string,
  done: boolean,
): Promise<BoardMarkResult> {
  try {
    const found = await meetingFor(id);
    if ('error' in found) return { error: found.error ?? null };
    if (!found.minutes.resolutions.some((r) => r.key === item)) {
      return { error: 'That resolution is not in these minutes.' };
    }
    const saved = await saveBoardMark(found.client, found.user.id, id, {
      kind: 'resolution',
      item,
      value: done ? 'done' : 'open',
    });
    revalidatePath('/you/board');
    return { error: null, saved };
  } catch (error) {
    return failed(error, 'Your tick was not saved. Try again.');
  }
}

/**
 * Make a resolution a todo: a task of theirs, due on the resolution's day,
 * linked back to the meeting, and its id kept on the mark so the next
 * meeting can see whether it got done. A resolution already made a todo
 * keeps the one it has.
 */
// latency: pending
export async function makeResolutionTodo(id: string, item: string): Promise<BoardMarkResult> {
  try {
    const found = await meetingFor(id);
    if ('error' in found) return { error: found.error ?? null };
    const resolution = found.minutes.resolutions.find((r) => r.key === item);
    if (!resolution) return { error: 'That resolution is not in these minutes.' };
    const existing = found.marks.find((m) => m.kind === 'resolution' && m.item === item);
    if (existing?.todoId) return { error: null, saved: existing };

    const { timezone } = await loadAccountSettings(found.user.id);
    const title = plainText(resolution.what);
    const task = await createTask(
      found.user.id,
      {
        title: title.length > 500 ? `${title.slice(0, 499)}…` : title,
        body: `From the board's [${meetingTitle(found.meeting)}](/you/board/${id}).`,
        dueOn: resolution.day,
        dueTime: null,
        pinned: false,
        tags: [],
      },
      timezone,
    );
    if (task.error || !task.id) return { error: task.error ?? 'The todo was not made. Try again.' };

    const saved = await saveBoardMark(found.client, found.user.id, id, {
      kind: 'resolution',
      item,
      value: existing?.value ?? 'open',
      todoId: task.id,
    });
    revalidatePath('/you/board');
    revalidatePath('/todo');
    return { error: null, saved };
  } catch (error) {
    return failed(error, 'The todo was not made. Try again.');
  }
}

/**
 * Call a meeting about one decision: queue a called meeting and fire the board
 * routine with its brief (plan #2540.5). The meeting runs on the account's
 * plan, so it only starts when the person presses the button. One meeting is
 * open at a time; a second press is told so.
 */
// latency: pending
export async function callMeeting(decision: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  const result = await callBoardMeeting({
    client: await createYouClient(),
    userId: user.id,
    decision,
    routine: boardRoutine(),
  });
  revalidatePath('/you/board');
  return { error: result.started ? null : result.error };
}

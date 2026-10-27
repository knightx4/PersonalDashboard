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
  cleanQuestion,
  insertBoardQuestion,
  listBoardAdvisors,
  loadBoardQuestion,
  moveBoardQuestion,
  type BoardQuestion,
  type QuestionInput,
} from '@/lib/you/board-questions';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import {
  ANSWER_MAX,
  clearBoardMark,
  loadBoardMeeting,
  meetingState,
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
 * Fire a called meeting about one question (plan #2561.4, replacing Call a
 * meeting from #2540.5). The question stays queued with no meeting: the
 * meeting itself moves it to discussing and names itself on it
 * (.claude/skills/board/SKILL.md). The meeting runs on the account's plan, so
 * it only starts when the person presses. One meeting is open at a time; a
 * second is told so and the question waits for Sunday.
 */
async function convene(
  client: YouSupabaseClient,
  userId: string,
  question: BoardQuestion,
): Promise<{ error: string | null }> {
  const result = await callBoardMeeting({
    client,
    userId,
    decision: question.question,
    questionIds: [question.id],
    routine: boardRoutine(),
  });
  if (result.started) return { error: null };
  if (result.reason === 'running') return { error: QUEUED_WHILE_RUNNING };
  return { error: `Your question is saved for Sunday, but the meeting did not start: ${result.error}` };
}

const QUEUED_WHILE_RUNNING =
  'A board meeting is already running, so your question is saved for Sunday. Press Ask now on it once that meeting ends.';

/**
 * Ask the board a question: save it queued, and with `now` convene a meeting
 * about it at once. A meeting that cannot start leaves the question queued
 * for Sunday and says why, with `queued` and its id so the card can close
 * and the question's row can say why.
 */
// latency: pending
export async function askBoard(
  input: QuestionInput,
  when: 'now' | 'sunday',
): Promise<{ error: string | null; queued?: boolean; questionId?: string }> {
  try {
    const user = await requireUser();
    const client = await createYouClient();
    const roster = await listBoardAdvisors(client, user.id);
    const clean = cleanQuestion(
      input,
      roster.map((a) => a.key),
    );
    if (!clean.ok) return { error: clean.error };
    const question = await insertBoardQuestion(client, user.id, clean.value);
    const result = when === 'now' ? await convene(client, user.id, question) : { error: null };
    revalidatePath('/you/board');
    return { error: result.error, queued: true, questionId: question.id };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Your question was not saved. Try again.' };
  }
}

const questionId = z.string().uuid();

async function questionFor(id: string) {
  if (!questionId.safeParse(id).success) return { error: 'That is not a question for the board.' } as const;
  const user = await requireUser();
  const client = await createYouClient();
  const question = await loadBoardQuestion(client, user.id, id);
  if (!question) return { error: 'That question is not yours or no longer exists.' } as const;
  return { user, client, question } as const;
}

/** Take up one of the board's suggestions: queue it for Sunday, or convene now. */
// latency: pending
export async function acceptSuggestion(
  id: string,
  when: 'now' | 'sunday',
): Promise<{ error: string | null }> {
  try {
    const found = await questionFor(id);
    if ('error' in found) return { error: found.error ?? null };
    const moved = await moveBoardQuestion(found.client, found.user.id, id, ['suggested'], {
      status: 'queued',
    });
    if (!moved) return { error: 'This suggestion has already been taken up or dismissed.' };
    const result =
      when === 'now' ? await convene(found.client, found.user.id, found.question) : { error: null };
    revalidatePath('/you/board');
    return result;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'The suggestion was not taken up. Try again.',
    };
  }
}

/** Turn down one of the board's suggestions. */
// latency: pending
export async function dismissSuggestion(id: string): Promise<{ error: string | null }> {
  try {
    const found = await questionFor(id);
    if ('error' in found) return { error: found.error ?? null };
    const moved = await moveBoardQuestion(found.client, found.user.id, id, ['suggested'], {
      status: 'dismissed',
    });
    revalidatePath('/you/board');
    return { error: moved ? null : 'This suggestion has already been taken up or dismissed.' };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'The suggestion was not dismissed. Try again.',
    };
  }
}

/**
 * Convene now about a question already asked: one queued for Sunday, one the
 * board put off, or one whose meeting stopped without finishing, which goes
 * back on the agenda first (the agenda takes only questions with no meeting).
 */
// latency: pending
export async function conveneQuestion(id: string): Promise<{ error: string | null }> {
  try {
    const found = await questionFor(id);
    if ('error' in found) return { error: found.error ?? null };
    const { client, user, question } = found;
    if (question.status === 'discussing') {
      const held = question.meetingId
        ? await loadBoardMeeting(client, user.id, question.meetingId)
        : null;
      if (held && meetingState(held.meeting).kind !== 'failed') {
        return { error: 'The board is already working on this question.' };
      }
    } else if (question.status !== 'queued' && question.status !== 'deferred') {
      return { error: 'This question is not waiting on the board.' };
    }
    if (question.status !== 'queued') {
      const moved = await moveBoardQuestion(client, user.id, id, ['discussing', 'deferred'], {
        status: 'queued',
        meeting_id: null,
      });
      if (!moved) return { error: 'This question changed while you were looking. Read the page again.' };
    }
    const result = await convene(client, user.id, question);
    revalidatePath('/you/board');
    return result;
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'The meeting did not start. Try again.' };
  }
}

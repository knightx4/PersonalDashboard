'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { boardRoutine } from '@/lib/feedback/routine';
import { createTask } from '@/lib/todo/tasks/write';
import { createYouClient } from '@/lib/you/auth/server';
import { listRoster } from '@/lib/you/board-advisors';
import {
  forgetMemory,
  loadNote,
  markMentorRead,
  markNotesRead,
  REACTION_NOTE_MAX,
  REACTIONS,
  reactToNote,
  sendToMentor,
  setCommitmentDone,
  setNoteTask,
  todoTitleFromNote,
  type Reaction,
} from '@/lib/you/council';

/**
 * What the person does on the Council (you 0037): read a mentor's note,
 * say what they made of it, make it a todo, talk to a mentor, and keep a
 * mentor's memory of them honest. Every action names the signed-in person,
 * and a note or a memory is only changed when it is theirs.
 */

export type CouncilResult = { error: string | null };

const id = z.string().uuid();

const failed = (error: unknown, fallback: string): CouncilResult => ({
  error: error instanceof Error ? error.message : fallback,
});

function refresh(key?: string) {
  revalidatePath('/you/council');
  if (key) revalidatePath(`/you/council/mentors/${key}`);
}

/** Mark notes read: one with Got it, or all with Mark all read. */
// latency: pending
export async function readCouncilNotes(ids: string[]): Promise<CouncilResult> {
  if (!ids.every((n) => id.safeParse(n).success)) return { error: 'That is not a council note.' };
  try {
    const user = await requireUser();
    await markNotesRead(await createYouClient(), user.id, ids);
    refresh();
    return { error: null };
  } catch (error) {
    return failed(error, 'The notes were not marked read. Try again.');
  }
}

/** Opening a mentor's page reads their notes. */
// latency: pending
export async function readMentor(advisorId: string, key: string): Promise<CouncilResult> {
  if (!id.safeParse(advisorId).success) return { error: 'That is not a mentor.' };
  try {
    const user = await requireUser();
    await markMentorRead(await createYouClient(), user.id, advisorId);
    refresh(key);
    return { error: null };
  } catch (error) {
    return failed(error, 'The notes were not marked read.');
  }
}

/** Useful, not useful, or disagree, with an optional line of why. Null takes it off. */
// latency: pending
export async function reactToCouncilNote(
  noteId: string,
  reaction: Reaction | null,
  note?: string | null,
): Promise<CouncilResult> {
  if (!id.safeParse(noteId).success) return { error: 'That is not a council note.' };
  if (reaction !== null && !(REACTIONS as readonly string[]).includes(reaction)) return { error: 'That is not a reaction.' };
  if (note && note.length > REACTION_NOTE_MAX) return { error: 'Keep it to at most 1,000 characters.' };
  try {
    const user = await requireUser();
    const client = await createYouClient();
    if (!(await loadNote(client, user.id, noteId))) return { error: 'That note is not yours or no longer exists.' };
    await reactToNote(client, user.id, noteId, reaction, note ?? null);
    refresh();
    return { error: null };
  } catch (error) {
    return failed(error, 'That was not saved. Try again.');
  }
}

/** A todo from a note, linked back to the mentor who wrote it. A note already made a todo keeps it. */
// latency: pending
export async function makeTodoFromNote(noteId: string): Promise<CouncilResult> {
  if (!id.safeParse(noteId).success) return { error: 'That is not a council note.' };
  try {
    const user = await requireUser();
    const client = await createYouClient();
    const note = await loadNote(client, user.id, noteId);
    if (!note) return { error: 'That note is not yours or no longer exists.' };
    if (note.taskId) return { error: null };
    const mentor = (await listRoster(client, user.id)).find((a) => a.id === note.advisorId);
    const { timezone } = await loadAccountSettings(user.id);
    const from = mentor ? `[${mentor.name}](/you/council/mentors/${mentor.key})` : 'your council';
    const task = await createTask(
      user.id,
      {
        title: todoTitleFromNote(note.text),
        body: `${note.text}\n\nFrom ${from}.`,
        dueOn: null,
        dueTime: null,
        pinned: false,
        tags: [],
      },
      timezone,
    );
    if (task.error || !task.id) return { error: task.error ?? 'The todo was not made. Try again.' };
    await setNoteTask(client, user.id, noteId, task.id);
    refresh(mentor?.key);
    revalidatePath('/todo');
    return { error: null };
  } catch (error) {
    return failed(error, 'The todo was not made. Try again.');
  }
}

/** Send a mentor a message, about one of their notes when `noteId` is given. */
// latency: pending
export async function sendMentorMessage(
  advisorId: string,
  text: string,
  noteId?: string | null,
): Promise<{ error: string | null; saved: boolean }> {
  if (!id.safeParse(advisorId).success) return { error: 'That is not a mentor.', saved: false };
  if (noteId && !id.safeParse(noteId).success) return { error: 'That is not a council note.', saved: false };
  try {
    const user = await requireUser();
    const client = await createYouClient();
    const mentor = (await listRoster(client, user.id)).find((a) => a.id === advisorId);
    if (!mentor) return { error: 'That mentor is not on your council.', saved: false };
    if (noteId) {
      const note = await loadNote(client, user.id, noteId);
      if (!note || note.advisorId !== advisorId) return { error: 'That note is not from this mentor.', saved: false };
    }
    const result = await sendToMentor({
      client,
      userId: user.id,
      mentor: { id: mentor.id, name: mentor.name, canTalk: mentor.kind === 'seat' || mentor.brainStatus === 'ready' },
      text,
      noteId: noteId ?? null,
      routine: boardRoutine(),
    });
    refresh(mentor.key);
    return result;
  } catch (error) {
    return { ...failed(error, 'Your message was not sent. Try again.'), saved: false };
  }
}

/** A commitment done, or not done after all. */
// latency: pending
export async function setCommitment(memoryId: string, done: boolean, key: string): Promise<CouncilResult> {
  if (!id.safeParse(memoryId).success) return { error: 'That is not a commitment.' };
  try {
    const user = await requireUser();
    await setCommitmentDone(await createYouClient(), user.id, memoryId, done);
    refresh(key);
    return { error: null };
  } catch (error) {
    return failed(error, 'That was not saved. Try again.');
  }
}

/** Have a mentor forget something they noted about you. */
// latency: pending
export async function forgetMentorMemory(memoryId: string, key: string): Promise<CouncilResult> {
  if (!id.safeParse(memoryId).success) return { error: 'That is not something a mentor noted.' };
  try {
    const user = await requireUser();
    await forgetMemory(await createYouClient(), user.id, memoryId);
    refresh(key);
    return { error: null };
  } catch (error) {
    return failed(error, 'That was not forgotten. Try again.');
  }
}

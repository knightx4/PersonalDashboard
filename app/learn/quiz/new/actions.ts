'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { createQuiz, type NewQuizSource } from '@/lib/learn/quiz/save';
import {
  MAX_PASTE_CHARS,
  MAX_PREPARING_FOR_CHARS,
  MAX_QUIZ_NOTES,
  quizTitle,
} from '@/lib/learn/quiz/model';
import { createVaultClient } from '@/lib/vault/auth/server';
import { loadNotesByIds } from '@/lib/vault/notes/load';

/**
 * Choosing what a quiz is over.
 *
 * One write and no model call. The questions are written on the next screen,
 * which is what keeps this one honest: picking three notes and changing your
 * mind costs nothing, and a quiz with material and no questions is a legible
 * row rather than a half-finished call.
 *
 * The note ids arrive from the browser, so they are read back through the
 * vault's own session client before anything is written. That read is what
 * turns an id into a name for the title; the database refuses a note somebody
 * else owns either way, through the trigger on learn.quiz_sources.
 */

export type NewQuizState = { error?: string };

const NewQuizInput = z.object({
  noteIds: z
    .array(z.string().uuid())
    .max(MAX_QUIZ_NOTES, `Ten notes is the most one quiz is written from.`),
  paste: z.string().trim().max(MAX_PASTE_CHARS, 'That paste is longer than a quiz can read.'),
  preparingFor: z
    .string()
    .trim()
    .max(MAX_PREPARING_FOR_CHARS, 'Shorter is better here — it is what the questions get aimed at.'),
});

// latency: pending
export async function startQuiz(
  _prev: NewQuizState,
  formData: FormData,
): Promise<NewQuizState> {
  const user = await requireUser();

  const parsed = NewQuizInput.safeParse({
    noteIds: formData.getAll('noteId').map(String),
    paste: formData.get('paste') ?? '',
    preparingFor: formData.get('preparingFor') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Could not read that.' };
  }

  // The same note twice is material counted twice, and the database says so
  // through a unique index. Said here instead of coming back as a constraint.
  const noteIds = [...new Set(parsed.data.noteIds)];
  const { paste, preparingFor } = parsed.data;

  if (noteIds.length === 0 && paste.length === 0) {
    return { error: 'Pick a note or paste something to be quizzed on.' };
  }

  const notes = await loadNotesByIds(await createVaultClient(), noteIds);
  if (notes.length < noteIds.length) {
    return { error: 'One of those notes is no longer in your vault.' };
  }

  const sources: NewQuizSource[] = notes.map((note) => ({ noteId: note.id }));
  if (paste.length > 0) sources.push({ body: paste });

  const supabase = await createLearnClient();
  const quizId = await createQuiz(supabase, user.id, {
    title: quizTitle({
      preparingFor,
      noteNames: notes.map((note) => note.title),
      today: new Date().toISOString().slice(0, 10),
    }),
    preparingFor: preparingFor.length > 0 ? preparingFor : null,
    sources,
  });

  revalidatePath('/learn/quiz');
  redirect(`/learn/quiz/${quizId}`);
}

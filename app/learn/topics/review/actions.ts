'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { moveSubject, settleMoveReview, type MoveResult } from '@/lib/learn/levels/move-store';

/**
 * Moving the claims graph onto topics (docs/LEARN-LEVELS-SPEC.md, "Migration
 * from the claims graph"; plan #2138.4).
 *
 * One subject a press. The page's Move button calls this once for each
 * subject still to move, in turn, so each call fits in one request, the
 * page can say how far it has got, and a subject that fails says why on its
 * own row while the rest carry on.
 */

// latency: pending
export async function moveClaimsSubject(subjectId: string): Promise<MoveResult> {
  const user = await requireUser();
  const id = z.string().uuid().safeParse(subjectId);
  if (!id.success) return { ok: false, detail: 'Could not tell which subject that was.' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, detail: 'Moving a subject needs ANTHROPIC_API_KEY to be set.' };

  const supabase = await createLearnClient();
  return moveSubject(supabase, user.id, id.data, apiKey);
}

/** Called once the run ends, so the lists read what the run wrote. */
// latency: instant
export async function refreshMoveReview(): Promise<void> {
  await requireUser();
  revalidatePath('/learn/topics/review');
  revalidatePath('/learn/topics');
}

export type AnswerState = { error?: string };

const AnswerInput = z.object({
  id: z.string().uuid(),
  decision: z.enum(['kept', 'moved']),
  level: z.coerce.number().int().min(1).max(10).optional(),
});

// latency: pending
export async function answerMoveReview(_prev: AnswerState, formData: FormData): Promise<AnswerState> {
  const user = await requireUser();
  const level = formData.get('level');
  const parsed = AnswerInput.safeParse({
    id: formData.get('id'),
    decision: formData.get('decision'),
    level: typeof level === 'string' && level !== '' ? level : undefined,
  });
  if (!parsed.success) return { error: 'Could not read that answer.' };

  const supabase = await createLearnClient();
  try {
    await settleMoveReview(supabase, user.id, parsed.data);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Keeping your answer failed.' };
  }
  revalidatePath('/learn/topics/review');
  return {};
}

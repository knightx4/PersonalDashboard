'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { nextItemIndex, parseSet } from '@/lib/learn/external/model';
import { createExternalCheck, loadExternalCheck, recordExternalAnswer } from '@/lib/learn/external/store';
import { gradeQuizAnswer } from '@/lib/learn/quiz/grade';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';

/**
 * Sitting an external item set (plan #2179.4).
 *
 * The set is pasted once and kept on its own row. Each answer is marked as it
 * is given and the mark is kept, but never returned: the score is the first
 * thing the person learns about how it went, after the last item. Nothing
 * here reads or writes the concept graph.
 */

export type SitState = { error?: string };

const StartInput = z.object({
  name: z.string().trim().min(1, 'Name the set.').max(120),
  set: z.string().trim().min(1, 'Paste the questions and answers.').max(60_000),
});

// latency: pending
export async function startExternalCheck(_prev: SitState, formData: FormData): Promise<SitState> {
  const user = await requireUser();
  const parsed = StartInput.safeParse({
    name: formData.get('name') ?? '',
    set: formData.get('set') ?? '',
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Could not read that.' };

  const items = parseSet(parsed.data.set);
  if (!items.ok) return { error: items.error };

  let id: string;
  try {
    id = await createExternalCheck(await createLearnClient(), user.id, {
      name: parsed.data.name,
      items: items.items,
    });
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : 'Could not keep that set.' };
  }
  redirect(`/learn/settings/external/${id}`);
}

const AnswerInput = z.object({
  checkId: z.string().uuid(),
  response: z.string().trim().min(1, 'Write something, or pass on it.').max(2000),
});

const SkipInput = z.object({ checkId: z.string().uuid() });

// latency: pending
export async function answerExternal(_prev: SitState, formData: FormData): Promise<SitState> {
  const user = await requireUser();
  const parsed = AnswerInput.safeParse({
    checkId: formData.get('checkId') ?? '',
    response: formData.get('response') ?? '',
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Could not read that answer.' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Marking an answer needs ANTHROPIC_API_KEY to be set.' };

  const supabase = await createLearnClient();
  const check = await loadExternalCheck(supabase, parsed.data.checkId);
  if (!check) return { error: 'Could not find that set.' };
  const index = nextItemIndex(check.items);
  if (index === null) {
    revalidatePath(`/learn/settings/external/${check.id}`);
    return {};
  }
  const item = check.items[index];
  if (!item) return { error: 'Could not find the question being answered.' };

  const spend = collectSpend();
  const grade = await gradeQuizAnswer({
    source: `a published question set called "${check.name}"`,
    question: item.question,
    expected: item.expected,
    response: parsed.data.response,
    anthropicApiKey: apiKey,
    onSpend: spend.sink,
  });
  await recordLearnSpend(user.id, 'grade-quiz-answer', spend.reports);
  if (!grade.ok) return { error: grade.detail };

  try {
    await recordExternalAnswer(supabase, check, { response: parsed.data.response, correct: grade.correct });
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : 'Could not keep that answer.' };
  }
  revalidatePath(`/learn/settings/external/${check.id}`);
  return {};
}

// latency: pending
export async function skipExternal(_prev: SitState, formData: FormData): Promise<SitState> {
  await requireUser();
  const parsed = SkipInput.safeParse({ checkId: formData.get('checkId') ?? '' });
  if (!parsed.success) return { error: 'Could not work out which set that was.' };

  const supabase = await createLearnClient();
  const check = await loadExternalCheck(supabase, parsed.data.checkId);
  if (!check) return { error: 'Could not find that set.' };
  try {
    await recordExternalAnswer(supabase, check, { response: '', correct: false });
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : 'Could not keep that.' };
  }
  revalidatePath(`/learn/settings/external/${check.id}`);
  return {};
}

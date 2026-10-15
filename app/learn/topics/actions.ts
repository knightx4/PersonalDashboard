'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { runTopicDraft } from '@/lib/learn/levels/draft-run';

/**
 * Naming a goal on the topics page drafts its topic (docs/LEARN-LEVELS-SPEC.md,
 * "Drafting a topic"; plan #2138.2). The draft is kept as a draft, which
 * nothing asks about, and the press lands on its page to be read, reworded
 * and approved.
 */

export type DraftState = { error?: string };

const GoalInput = z
  .string()
  .trim()
  .min(2, 'Name what you want to know.')
  .max(300, 'Shorter is better here. Name one topic, such as DCF or Braess’s paradox.');

// latency: pending
export async function draftTopicFromGoal(_prev: DraftState, formData: FormData): Promise<DraftState> {
  const user = await requireUser();
  const goal = GoalInput.safeParse(formData.get('goal') ?? '');
  if (!goal.success) return { error: goal.error.issues[0]?.message ?? 'Could not read that goal.' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Drafting a topic needs ANTHROPIC_API_KEY to be set.' };

  const supabase = await createLearnClient();
  let id: string;
  try {
    const result = await runTopicDraft(supabase, user.id, { goal: goal.data, anthropicApiKey: apiKey });
    if (!result.ok) return { error: result.detail };
    id = result.id;
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Drafting the topic failed.' };
  }

  revalidatePath('/learn/topics');
  redirect(`/learn/topics/${id}`);
}

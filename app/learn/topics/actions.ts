'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { numbered, performancesFromText, sourcesFromText, type DraftSources } from '@/lib/learn/levels/draft-sources';
import { runTopicDraft } from '@/lib/learn/levels/draft-run';
import { roleRequirementSource } from '@/lib/learn/levels/role-sources';

/**
 * Naming a goal on the topics page drafts its topic (docs/LEARN-LEVELS-SPEC.md,
 * "Drafting a topic"; plan #2138.2). The draft is approved as soon as it is
 * kept (plan #2356.2), any row citing no source marked personal (plan
 * #2356.6), and the press lands on the topic's page.
 *
 * Since plan #2138.11 the box also takes what to draft from: the goal's
 * performances, pasted sources, and a phrase naming roles in job_search whose
 * requirement lines join them. The call runs twice and cites them on every
 * row.
 */

/** `queued` is what the press says once the topic is with the routine (learn 0193). */
export type DraftState = { error?: string; queued?: string };

const GoalInput = z
  .string()
  .trim()
  .min(2, 'Name what you want to know.')
  .max(300, 'Shorter is better here. Name one topic, such as DCF or Braess’s paradox.');

const text = (value: FormDataEntryValue | null, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');

// latency: pending
export async function draftTopicFromGoal(_prev: DraftState, formData: FormData): Promise<DraftState> {
  const user = await requireUser();
  const goal = GoalInput.safeParse(formData.get('goal') ?? '');
  if (!goal.success) return { error: goal.error.issues[0]?.message ?? 'Could not read that goal.' };

  let sources: DraftSources;
  try {
    const roles = await roleRequirementSource(text(formData.get('roles'), 120));
    const pasted = sourcesFromText(text(formData.get('sources'), 40_000));
    sources = {
      sources: numbered([...(roles ? [roles] : []), ...pasted]),
      performances: performancesFromText(text(formData.get('performances'), 2_000)),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Reading the sources failed.' };
  }
  if (text(formData.get('roles'), 120).trim() !== '' && !sources.sources.some((s) => s.label.startsWith('Requirement lines'))) {
    return { error: 'No role you pursued has that in its title with requirement lines. Try a shorter phrase, such as FP&A.' };
  }

  const supabase = await createLearnClient();
  try {
    // Approved as soon as the routine keeps it, as the press used to here.
    const result = await runTopicDraft(supabase, user.id, { goal: goal.data, sources, after: { approve: true } });
    if (!result.ok) return { error: result.detail };
    revalidatePath('/learn/topics');
    return { queued: result.detail };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Drafting the topic failed.' };
  }
}

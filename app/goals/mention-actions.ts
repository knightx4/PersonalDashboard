'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { dismissMention, undismissMention } from '@/lib/goals/mentions-store';

/**
 * Decline on a mention under "Coming up, optional" on the Goals home, and
 * the toast's Undo (plan #2503.5). The row in goals.mentions is what keeps a
 * declined mention off the home and out of the next morning's brief.
 */

export type MentionActionState = { error?: string };

const Ref = z.string().regex(/^(step|suggestion):[0-9a-f-]{36}$/);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// latency: optimistic
export async function dismissMentionAction(ref: string, on: string): Promise<MentionActionState> {
  const user = await requireUser();
  const r = Ref.safeParse(ref);
  const d = Day.safeParse(on);
  if (!r.success || !d.success) return { error: 'Could not tell which mention that was.' };
  try {
    await dismissMention(await createGoalsClient(), user.id, { ref: r.data, on: d.data });
  } catch {
    return { error: 'It could not be declined. Try again.' };
  }
  revalidatePath('/goals');
  return {};
}

// latency: optimistic
export async function undismissMentionAction(ref: string): Promise<MentionActionState> {
  const user = await requireUser();
  const r = Ref.safeParse(ref);
  if (!r.success) return { error: 'Could not tell which mention that was.' };
  try {
    await undismissMention(await createGoalsClient(), user.id, r.data);
  } catch {
    return { error: 'It could not be brought back. Try again.' };
  }
  revalidatePath('/goals');
  return {};
}

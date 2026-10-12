'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { PIN_KINDS } from '@/lib/learn/essays/model';
import { createEssay } from '@/lib/learn/essays/store';

/**
 * "New essay" on the Essays page (plan #1865): an empty essay, opened in the
 * editor on the first question of its interview (plan #1867).
 */
// latency: pending
export async function startEssay(): Promise<void> {
  const user = await requireUser();
  const supabase = await createLearnClient();
  const id = await createEssay(supabase, user.id);
  redirect(`/learn/e/${id}`);
}

const FromInput = z.object({
  kind: z.enum(PIN_KINDS),
  ref: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(300),
});

/**
 * "Write about this" on a Learn page (plan #1867): a new essay with what it
 * was started from pinned to its brief, opened on an interview whose first
 * question names it.
 */
// latency: pending
export async function startEssayFrom(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = FromInput.safeParse({
    kind: formData.get('kind'),
    ref: formData.get('ref'),
    title: formData.get('title'),
  });
  if (!parsed.success) throw new Error('Could not tell what the essay is about.');
  const supabase = await createLearnClient();
  const id = await createEssay(supabase, user.id, [
    { kind: parsed.data.kind, id: parsed.data.ref, title: parsed.data.title },
  ]);
  redirect(`/learn/e/${id}`);
}

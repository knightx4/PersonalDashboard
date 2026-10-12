'use server';

import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { createEssay } from '@/lib/learn/essays/store';

/**
 * "New essay" on the Essays page (plan #1865): an empty essay, opened in the
 * editor. The short interview that fills the brief first is a later step
 * (#1867); until then the brief starts empty, which the spec allows.
 */
// latency: pending
export async function startEssay(): Promise<void> {
  const user = await requireUser();
  const supabase = await createLearnClient();
  const id = await createEssay(supabase, user.id);
  redirect(`/learn/e/${id}`);
}

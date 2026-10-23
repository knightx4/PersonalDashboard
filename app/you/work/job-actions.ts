'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createClient as createJobsClient } from '@/lib/jobs/auth/server';
import { createYouClient } from '@/lib/you/auth/server';
import { EDUCATION_HREF } from '@/lib/you/education';
import { parseJob } from '@/lib/you/work-history';
import { saveJob } from '@/lib/you/work-history-store';
import { readResumeIntoWorkHistory } from '@/lib/you/work-history-run';

/**
 * The jobs on You's Work & school tab (plan #1991.4).
 *
 * `readResumeAction` reads the default résumé in Jobs and writes what it
 * finds straight into the list, replacing the rows an earlier read wrote and
 * leaving every row you edited or added (planRead in lib/you/work-history.ts).
 * `saveJobAction` corrects a row or adds one, and marks it as yours so a
 * later read leaves it alone. Everything runs on the session clients, so RLS
 * decides what is yours.
 */

export type ReadResumeState = {
  error?: string;
  read?: { added: number; kept: number; resume: string };
};

/** Read the jobs off your default résumé into the list. */
// latency: pending
export async function readResumeAction(): Promise<ReadResumeState> {
  const user = await requireUser();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'This deployment has no ANTHROPIC_API_KEY, so Dash cannot read your résumé.' };

  const result = await readResumeIntoWorkHistory({
    jobs: await createJobsClient(),
    you: await createYouClient(),
    userId: user.id,
    apiKey,
  });
  if (!result.ok) return { error: result.error };

  revalidatePath(EDUCATION_HREF);
  return { read: { added: result.added, kept: result.kept, resume: result.resume } };
}

export type JobEditState = { error?: string; field?: string; saved?: boolean };

const id = z.string().uuid();

/** Correct a job, or add one when the form has no id. Either way it is yours from then on. */
// latency: pending
export async function saveJobAction(_prev: JobEditState, form: FormData): Promise<JobEditState> {
  const user = await requireUser();
  const read = parseJob((field) => {
    const value = form.get(field);
    return typeof value === 'string' ? value : '';
  });
  if (!read.ok) return { error: read.error, field: read.field };

  const rawId = form.get('id');
  let jobId: string | null = null;
  if (typeof rawId === 'string' && rawId !== '') {
    const parsed = id.safeParse(rawId);
    if (!parsed.success) return { error: 'That job could not be found.' };
    jobId = parsed.data;
  }
  try {
    const saved = await saveJob(await createYouClient(), user.id, jobId, read.job);
    if (!saved) return { error: 'That job could not be found.' };
  } catch {
    return { error: jobId ? 'The job was not saved. Try again.' : 'The job was not added. Try again.' };
  }

  revalidatePath(EDUCATION_HREF);
  return { saved: true };
}

export type RemoveJobResult = { ok: boolean; error?: string };

/** Remove one job from the list. */
// latency: pending
export async function removeJobAction(form: FormData): Promise<RemoveJobResult> {
  const user = await requireUser();
  const jobId = id.safeParse(form.get('id'));
  if (!jobId.success) return { ok: false, error: 'That job could not be found.' };
  const you = await createYouClient();
  const { error } = await you.from('work_history').delete().eq('id', jobId.data).eq('user_id', user.id);
  if (error) return { ok: false, error: 'The job was not removed. Try again.' };
  revalidatePath(EDUCATION_HREF);
  return { ok: true };
}

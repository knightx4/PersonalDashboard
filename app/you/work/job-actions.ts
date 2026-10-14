'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createClient as createJobsClient } from '@/lib/jobs/auth/server';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import { createYouClient } from '@/lib/you/auth/server';
import { EDUCATION_HREF } from '@/lib/you/education';
import { resumeHash } from '@/lib/you/resume-hash';
import { parseJob, planRead, type Job } from '@/lib/you/work-history';
import { askWorkHistoryModel, WORK_HISTORY_OPERATION } from '@/lib/you/work-history-model';
import { readWorkHistory } from '@/lib/you/work-history-read';

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

  const jobs = await createJobsClient();
  const { data: resume } = await jobs
    .from('resume_versions')
    .select('id, label, text_content')
    .eq('user_id', user.id)
    .not('text_content', 'is', null)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const text = (resume as { text_content: string | null } | null)?.text_content ?? '';
  if (!resume || text.trim() === '') {
    return { error: 'There is no résumé with text in Jobs to read. Add one there first.' };
  }
  const { id: resumeId, label } = resume as { id: string; label: string };

  const spend = collectSpend();
  let read;
  try {
    read = await readWorkHistory(text, (body) => askWorkHistoryModel({ apiKey, onSpend: spend.sink }, body));
  } catch {
    read = { ok: false as const, error: 'Your résumé could not be read. Try again.' };
  }
  await recordLearnSpend(user.id, WORK_HISTORY_OPERATION, spend.reports);
  if (!read.ok) return { error: read.error };

  const you = await createYouClient();
  const { data: existing, error: loadError } = await you
    .from('work_history')
    .select('id, employer, title, started, edited');
  if (loadError) return { error: 'Your jobs could not be loaded. Try again.' };
  const plan = planRead((existing ?? []) as Pick<Job, 'id' | 'employer' | 'title' | 'started' | 'edited'>[], read.jobs);
  const hash = resumeHash(text);

  // Add the new read before taking the old one out, so a failure leaves the list as it was.
  if (plan.add.length > 0) {
    const { error } = await you.from('work_history').insert(
      plan.add.map((job, position) => ({
        ...job,
        user_id: user.id,
        edited: false,
        resume_id: resumeId,
        resume_hash: hash,
        position,
      })),
    );
    if (error) return { error: 'The jobs were not saved. Try again.' };
  }
  if (plan.remove.length > 0) {
    await you.from('work_history').delete().in('id', plan.remove).eq('edited', false).eq('user_id', user.id);
  }
  if (plan.confirmed.length > 0) {
    // Your rows that this résumé also lists: marked as found on it, with what they say unchanged.
    await you
      .from('work_history')
      .update({ resume_id: resumeId, resume_hash: hash })
      .in('id', plan.confirmed)
      .eq('user_id', user.id);
  }

  revalidatePath(EDUCATION_HREF);
  return { read: { added: plan.add.length, kept: plan.kept, resume: label } };
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

  const you = await createYouClient();
  const rawId = form.get('id');
  if (typeof rawId === 'string' && rawId !== '') {
    const jobId = id.safeParse(rawId);
    if (!jobId.success) return { error: 'That job could not be found.' };
    const { data, error } = await you
      .from('work_history')
      .update({ ...read.job, edited: true })
      .eq('id', jobId.data)
      .eq('user_id', user.id)
      .select('id');
    if (error) return { error: 'The job was not saved. Try again.' };
    if (!data || data.length === 0) return { error: 'That job could not be found.' };
  } else {
    const { error } = await you.from('work_history').insert({ ...read.job, user_id: user.id, edited: true });
    if (error) return { error: 'The job was not added. Try again.' };
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

import 'server-only';

import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { resumeHash } from '@/lib/you/resume-hash';
import { planRead, type Job } from '@/lib/you/work-history';
import { askWorkHistoryModel, WORK_HISTORY_OPERATION } from '@/lib/you/work-history-model';
import { readWorkHistory } from '@/lib/you/work-history-read';

/** What one read of the résumé did, or why it did not. */
export type ResumeReadOutcome =
  | { ok: true; added: number; kept: number; resume: string; resumeId: string; firstAddedId: string | null }
  | { ok: false; error: string };

/**
 * Read the jobs off the default résumé in Jobs into You's work history
 * (plan #1991.4): Read from résumé on the Work & school tab, and Dash's
 * read_resume_jobs once approved (plan #2228.5). Writes what it finds
 * straight into the list, replacing the rows an earlier read wrote and
 * leaving every row the person edited or added (planRead). Runs on the
 * person's own clients, so RLS decides what is theirs.
 */
export async function readResumeIntoWorkHistory(input: {
  jobs: AppSupabaseClient;
  you: YouSupabaseClient;
  userId: string;
  apiKey: string;
}): Promise<ResumeReadOutcome> {
  const { jobs, you, userId, apiKey } = input;
  const { data: resume } = await jobs
    .from('resume_versions')
    .select('id, label, text_content')
    .eq('user_id', userId)
    .not('text_content', 'is', null)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const text = (resume as { text_content: string | null } | null)?.text_content ?? '';
  if (!resume || text.trim() === '') {
    return { ok: false, error: 'There is no résumé with text in Jobs to read. Add one there first.' };
  }
  const { id: resumeId, label } = resume as { id: string; label: string };

  const spend = collectSpend();
  let read;
  try {
    read = await readWorkHistory(text, (body) => askWorkHistoryModel({ apiKey, onSpend: spend.sink }, body));
  } catch {
    read = { ok: false as const, error: 'Your résumé could not be read. Try again.' };
  }
  await recordLearnSpend(userId, WORK_HISTORY_OPERATION, spend.reports);
  if (!read.ok) return { ok: false, error: read.error };

  const { data: existing, error: loadError } = await you
    .from('work_history')
    .select('id, employer, title, started, edited');
  if (loadError) return { ok: false, error: 'Your jobs could not be loaded. Try again.' };
  const plan = planRead((existing ?? []) as Pick<Job, 'id' | 'employer' | 'title' | 'started' | 'edited'>[], read.jobs);
  const hash = resumeHash(text);

  // Add the new read before taking the old one out, so a failure leaves the list as it was.
  let firstAddedId: string | null = null;
  if (plan.add.length > 0) {
    const { data: added, error } = await you
      .from('work_history')
      .insert(
        plan.add.map((job, position) => ({
          ...job,
          user_id: userId,
          edited: false,
          resume_id: resumeId,
          resume_hash: hash,
          position,
        })),
      )
      .select('id');
    if (error) return { ok: false, error: 'The jobs were not saved. Try again.' };
    firstAddedId = ((added ?? []) as { id: string }[])[0]?.id ?? null;
  }
  if (plan.remove.length > 0) {
    await you.from('work_history').delete().in('id', plan.remove).eq('edited', false).eq('user_id', userId);
  }
  if (plan.confirmed.length > 0) {
    // Their rows that this résumé also lists: marked as found on it, with what they say unchanged.
    await you
      .from('work_history')
      .update({ resume_id: resumeId, resume_hash: hash })
      .in('id', plan.confirmed)
      .eq('user_id', userId);
  }
  return { ok: true, added: plan.add.length, kept: plan.kept, resume: label, resumeId, firstAddedId };
}

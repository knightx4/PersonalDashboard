import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';

/**
 * Resume versions on the Material page, as its forms and Dash's
 * add_resume_version and attach_resume_pdf write them (plan #2473.2). The PDF
 * is in the person's resumes folder before either is called; the row only
 * keeps the path.
 */

type Row = Record<string, unknown>;

/** Said when another version of theirs has the label. */
export const SAME_LABEL = 'You already have a version with that label.';

export async function addResumeRow(
  supabase: AppSupabaseClient,
  userId: string,
  version: { label: string; notes: string | null; text_content: string | null; storage_path: string | null },
): Promise<{ row: Row | null; error: string | null }> {
  const { data, error } = await supabase
    .from('resume_versions')
    .insert({ user_id: userId, ...version })
    .select('*')
    .maybeSingle();
  if (error) return { row: null, error: /resume_versions_user_label_key/.test(error.message) ? SAME_LABEL : error.message };
  return { row: (data as Row | null) ?? null, error: null };
}

/** Point a version at a PDF in their folder, in place of any it had. */
export async function pointResumeAt(
  supabase: AppSupabaseClient,
  userId: string,
  resumeVersionId: string,
  storagePath: string,
): Promise<{ row: Row | null; error: string | null }> {
  const { data, error } = await supabase
    .from('resume_versions')
    .update({ storage_path: storagePath })
    .eq('id', resumeVersionId)
    .eq('user_id', userId)
    .select('*')
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data as Row | null) ?? null, error: null };
}

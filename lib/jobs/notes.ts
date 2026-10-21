import { z } from 'zod';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';

/**
 * A note in job_search.notes: the company page's Add note and Dash's
 * change_company `note` both write through here (plan #2473.8).
 */

export type JobNoteInput = {
  body: string;
  companyId?: string;
  roleId?: string;
  applicationId?: string;
  contactId?: string;
  interviewId?: string;
};

/**
 * Notes attach to exactly one parent, enforced by a check constraint in the
 * database rather than by this code path remembering to.
 */
const noteSchema = z
  .object({
    body: z.string().trim().min(1, 'A note needs some text.'),
    companyId: z.string().uuid().optional(),
    roleId: z.string().uuid().optional(),
    applicationId: z.string().uuid().optional(),
    contactId: z.string().uuid().optional(),
    interviewId: z.string().uuid().optional(),
  })
  .refine(
    (value) =>
      [value.companyId, value.roleId, value.applicationId, value.contactId, value.interviewId].filter(Boolean).length === 1,
    { message: 'A note attaches to exactly one thing.' },
  );

/** File one note for the person and return the row as written, or the sentence saying why not. */
export async function fileJobNote(
  supabase: AppSupabaseClient,
  userId: string,
  input: JobNoteInput,
): Promise<{ row: Record<string, unknown>; note: JobNoteInput; error: null } | { row: null; note: null; error: string }> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { row: null, note: null, error: parsed.error.issues[0].message };

  const { data, error } = await supabase
    .from('notes')
    .insert({
      user_id: userId,
      body: parsed.data.body,
      company_id: parsed.data.companyId ?? null,
      role_id: parsed.data.roleId ?? null,
      application_id: parsed.data.applicationId ?? null,
      contact_id: parsed.data.contactId ?? null,
      interview_id: parsed.data.interviewId ?? null,
    })
    .select('*')
    .single();
  if (error || !data) return { row: null, note: null, error: error?.message ?? 'The note was not saved.' };
  return { row: data as Record<string, unknown>, note: parsed.data, error: null };
}

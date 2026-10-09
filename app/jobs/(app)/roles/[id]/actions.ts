'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { ensureCompany } from '@/lib/jobs/companies/ensure';

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
      [
        value.companyId,
        value.roleId,
        value.applicationId,
        value.contactId,
        value.interviewId,
      ].filter(Boolean).length === 1,
    { message: 'A note attaches to exactly one thing.' },
  );

// latency: pending
export async function addNote(input: {
  body: string;
  companyId?: string;
  roleId?: string;
  applicationId?: string;
  contactId?: string;
  interviewId?: string;
}): Promise<{ error: string | null }> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase.from('notes').insert({
    user_id: user.id,
    body: parsed.data.body,
    company_id: parsed.data.companyId ?? null,
    role_id: parsed.data.roleId ?? null,
    application_id: parsed.data.applicationId ?? null,
    contact_id: parsed.data.contactId ?? null,
    interview_id: parsed.data.interviewId ?? null,
  });

  if (error) return { error: error.message };

  if (parsed.data.roleId) revalidatePath(`/jobs/roles/${parsed.data.roleId}`);
  if (parsed.data.companyId) revalidatePath('/jobs/companies');
  if (parsed.data.contactId) revalidatePath('/jobs/contacts');

  // A note on a round is read on the role page, which is two joins away from
  // the id the note carries. Worth one lookup: without it the note is written
  // and the page it was written on does not show it.
  if (parsed.data.interviewId) {
    const { data: interview } = await supabase
      .from('interviews')
      .select('applications!inner ( role_id )')
      .eq('id', parsed.data.interviewId)
      .eq('user_id', user.id)
      .maybeSingle<{ applications: { role_id: string } }>();
    if (interview) revalidatePath(`/jobs/roles/${interview.applications.role_id}`);
  }

  return { error: null };
}

/**
 * The cover letter under the application's answers (note b4cecf70), in
 * applications.cover_letter. Not cover_letters.body, which is the shared case
 * page's statement and public once shared. Saving it empty clears it.
 */
// latency: pending
export async function saveCoverLetter(input: {
  applicationId: string;
  roleId: string;
  body: string;
}): Promise<{ error: string | null }> {
  const parsed = z
    .object({
      applicationId: z.string().uuid(),
      roleId: z.string().uuid(),
      body: z.string().trim().max(20_000, 'A cover letter is at most 20,000 characters.'),
    })
    .safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('applications')
    .update({ cover_letter: parsed.data.body || null })
    .eq('id', parsed.data.applicationId)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePath(`/jobs/roles/${parsed.data.roleId}`);
  return { error: null };
}

const renameRoleSchema = z.object({
  roleId: z.string().uuid(),
  title: z.string().trim().min(1, 'A role needs a name.').max(200),
});

/**
 * The inbox's best guess at a title is still a guess, and the ones it could
 * not read at all are left as "Role from email" -- both are worth overriding
 * by hand rather than living with.
 */
// latency: pending
export async function renameRole(roleId: string, title: string): Promise<{ error: string | null }> {
  const parsed = renameRoleSchema.safeParse({ roleId, title });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('roles')
    .update({ title: parsed.data.title })
    .eq('id', parsed.data.roleId)
    .eq('user_id', user.id);

  if (error) return { error: error.message };

  revalidatePath('/jobs/roles/[id]', 'page');
  revalidatePath('/jobs/roles');
  revalidatePath('/jobs/pipeline');
  revalidatePath('/jobs/companies/[slug]', 'page');
  revalidatePath('/jobs');
  return { error: null };
}

const moveRoleSchema = z.object({
  roleId: z.string().uuid(),
  companyName: z.string().trim().min(1, 'Which company is this?').max(200),
});

/**
 * Put a role under the company it actually belongs to.
 *
 * The linker attributes mail by sender domain, and a shared ATS domain or a
 * forwarded thread lands a pursuit under the wrong name often enough that
 * "delete it and start again" was the only remedy — which throws away the
 * timeline and every linked message with it. Moving the role keeps all of it.
 *
 * The company is resolved by name the same way creating a role resolves it, so
 * a company that is not on file yet is created rather than blocking the move.
 */
// latency: pending
export async function moveRoleToCompany(
  roleId: string,
  companyName: string,
): Promise<{ error: string | null; slug: string | null }> {
  const parsed = moveRoleSchema.safeParse({ roleId, companyName });
  if (!parsed.success) return { error: parsed.error.issues[0].message, slug: null };

  const user = await requireUser();
  const supabase = await createClient();

  const company = await ensureCompany(supabase, user.id, parsed.data.companyName);
  if (company.error) return { error: company.error, slug: null };

  const { error } = await supabase
    .from('roles')
    .update({ company_id: company.id })
    .eq('id', parsed.data.roleId)
    .eq('user_id', user.id);

  if (error) {
    // (user_id, company_id, jd_hash) is unique: the same posting is already
    // filed under the company being moved to.
    return {
      error:
        error.code === '23505'
          ? 'That company already has this same posting. Merge the two from the company page instead.'
          : error.message,
      slug: null,
    };
  }

  const { data: moved } = await supabase
    .from('companies')
    .select('slug')
    .eq('id', company.id)
    .maybeSingle();

  revalidatePath('/jobs/roles/[id]', 'page');
  revalidatePath('/jobs/roles');
  revalidatePath('/jobs/pipeline');
  revalidatePath('/jobs/companies');
  revalidatePath('/jobs/companies/[slug]', 'page');
  revalidatePath('/jobs');
  return { error: null, slug: (moved?.slug as string) ?? null };
}

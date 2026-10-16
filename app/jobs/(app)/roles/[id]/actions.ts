'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { ensureCompany } from '@/lib/jobs/companies/ensure';
import { createCoreClient } from '@/lib/core/auth/server';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import { draftAndSaveCoverLetter } from '@/lib/jobs/drafting/draft-cover-letter';
import type { CoverLetterDraftView } from '@/lib/jobs/drafting/draft-cover-letter-payload';
import { dropDraft, LETTER_KEY, saveReplies } from '@/lib/jobs/drafting/store';

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
 *
 * `fromDraft` is the save after Insert put Dash's draft in the editor (plan
 * #2135.2): the same write sets the Cover letter mark to Yes, and the draft
 * leaves application_drafts so a reload does not offer it again.
 */
// latency: pending
export async function saveCoverLetter(input: {
  applicationId: string;
  roleId: string;
  body: string;
  fromDraft?: boolean;
}): Promise<{ error: string | null }> {
  const parsed = z
    .object({
      applicationId: z.string().uuid(),
      roleId: z.string().uuid(),
      body: z.string().trim().max(20_000, 'A cover letter is at most 20,000 characters.'),
      fromDraft: z.boolean().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const marking = Boolean(parsed.data.fromDraft && parsed.data.body);
  const patch: { cover_letter: string | null; has_cover_letter?: boolean } = {
    cover_letter: parsed.data.body || null,
  };
  if (marking) patch.has_cover_letter = true;

  const { error } = await supabase
    .from('applications')
    .update(patch)
    .eq('id', parsed.data.applicationId)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  // Best effort: the letter is saved, and a draft left behind only offers
  // itself again on the next visit.
  if (parsed.data.fromDraft) await dropDraft(supabase, parsed.data.applicationId, 'cover_letter', LETTER_KEY);

  revalidatePath(`/jobs/roles/${parsed.data.roleId}`);
  if (marking) revalidatePath('/jobs');
  return { error: null };
}

/**
 * Throws Dash's drafted letter away (plan #2135.2). The questions it asked
 * and the replies stay on the row, for the next draft to use.
 */
// latency: pending
export async function dropCoverLetterDraft(input: { applicationId: string }): Promise<{ error: string | null }> {
  const parsed = z.object({ applicationId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  await requireUser();
  const supabase = await createClient();
  return dropDraft(supabase, parsed.data.applicationId, 'cover_letter', LETTER_KEY);
}

const repliesSchema = z.record(z.string().min(1), z.string().max(4_000, 'A reply is at most 4,000 characters.'));

const draftLetterSchema = z.object({
  applicationId: z.string().uuid(),
  replies: repliesSchema.optional(),
});

/**
 * Dash drafts a cover letter from everything on file for the application
 * (plan #2135.1), using any replies to its earlier questions, which are
 * saved first. The letter is kept in application_drafts beside the editor;
 * nothing reaches applications.cover_letter until the person inserts it and
 * saves with saveCoverLetter.
 */
// latency: pending
export async function draftCoverLetter(input: {
  applicationId: string;
  /** Replies to earlier asks, by ask id. */
  replies?: Record<string, string>;
}): Promise<{ draft: CoverLetterDraftView | null; error: string | null }> {
  const parsed = draftLetterSchema.safeParse(input);
  if (!parsed.success) return { draft: null, error: parsed.error.issues[0].message };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { draft: null, error: 'Drafting is not configured.' };

  const user = await requireUser();
  const [jobs, core] = await Promise.all([createClient(), createCoreClient()]);

  const spend: SpendReport[] = [];
  const result = await draftAndSaveCoverLetter(
    { jobs, core, apiKey, onSpend: (report) => spend.push(report) },
    { userId: user.id, applicationId: parsed.data.applicationId, replies: parsed.data.replies },
  );
  await recordSessionSpend(user.id, { module: 'jobs', operation: 'draft-cover-letter' }, spend);

  if (!result.ok) return { draft: null, error: result.error };
  return { draft: result.draft, error: null };
}

/**
 * Keeps the person's replies to Dash's questions about the letter without
 * redrafting, so what they typed survives a reload. An empty reply clears it.
 */
// latency: pending
export async function saveCoverLetterReplies(input: {
  applicationId: string;
  replies: Record<string, string>;
}): Promise<{ error: string | null }> {
  const parsed = z
    .object({ applicationId: z.string().uuid(), replies: repliesSchema })
    .safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  await requireUser();
  const supabase = await createClient();
  const { saved, error } = await saveReplies(supabase, parsed.data.applicationId, 'cover_letter', parsed.data.replies);
  if (error) return { error };
  if (!saved) return { error: 'There is no drafted letter to reply to.' };
  return { error: null };
}

const applicationMarksSchema = z
  .object({
    applicationId: z.string().uuid(),
    roleId: z.string().uuid(),
    readyToApply: z.boolean().optional(),
    allQuestionsAdded: z.boolean().optional(),
    /** true for yes, false for no, null to clear the answer. */
    hasCoverLetter: z.boolean().nullable().optional(),
  })
  .refine(
    (v) =>
      v.readyToApply !== undefined ||
      v.allQuestionsAdded !== undefined ||
      v.hasCoverLetter !== undefined,
    {
      message: 'Nothing to save.',
    },
  );

/**
 * Saves the marks on an application: ready to apply, all questions added, and
 * whether it has a cover letter. Either or both may be sent; a field left out is not touched.
 * hasCoverLetter is your own answer (null clears it), separate from whether
 * applications.cover_letter holds text.
 */
// latency: pending
export async function saveApplicationMarks(input: {
  applicationId: string;
  roleId: string;
  readyToApply?: boolean;
  allQuestionsAdded?: boolean;
  hasCoverLetter?: boolean | null;
}): Promise<{ error: string | null }> {
  const parsed = applicationMarksSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const patch: {
    ready_to_apply?: boolean;
    all_questions_added?: boolean;
    has_cover_letter?: boolean | null;
  } = {};
  if (parsed.data.readyToApply !== undefined) patch.ready_to_apply = parsed.data.readyToApply;
  if (parsed.data.allQuestionsAdded !== undefined) patch.all_questions_added = parsed.data.allQuestionsAdded;
  if (parsed.data.hasCoverLetter !== undefined) patch.has_cover_letter = parsed.data.hasCoverLetter;

  const { error } = await supabase
    .from('applications')
    .update(patch)
    .eq('id', parsed.data.applicationId)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePath(`/jobs/roles/${parsed.data.roleId}`);
  revalidatePath('/jobs');
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

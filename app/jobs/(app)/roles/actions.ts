'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { fetchPostingFromUrl, fetchQuestionsFromUrl, detectPosting } from '@/lib/jobs/ats';
import { extractCompBand, extractRequirements, guessSeniority, guessWorkMode, jdHash } from '@/lib/jobs/jd/requirements';
import { domainFromUrl, slugify } from '@/lib/jobs/slug';
import { guessQuestionKind, questionFingerprint, splitQuestionBlock } from '@/lib/jobs/fingerprint';
import { APPLICATION_SOURCES } from '@/lib/jobs/pipeline';

/**
 * Creating a role.
 *
 * Creating a role creates its application in the same action unless it is
 * explicitly saved as a lead. The three-level split is a modelling decision;
 * the interface should not make the user perform it.
 */

export interface RoleFormState {
  error?: string;
  notice?: string;
  fetched?: {
    title: string;
    text: string;
    location: string | null;
    atsJobId: string | null;
    boardToken: string | null;
    vendor: string;
    questionCount: number;
  };
}

/** Find or create the company, filling in domains from the URL we have. */
async function ensureCompany(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  name: string,
  hints: { careersUrl?: string | null; website?: string | null; boardToken?: string | null; ats?: string | null },
): Promise<{ id: string; error: string | null }> {
  const slug = slugify(name);

  const { data: existing } = await supabase
    .from('companies')
    .select('id, domains, ats_board_token')
    .eq('user_id', userId)
    .eq('slug', slug)
    .maybeSingle();

  const domain = domainFromUrl(hints.website) ?? domainFromUrl(hints.careersUrl);

  if (existing) {
    // Top up what we learned without clobbering anything the user edited.
    const patch: Record<string, unknown> = {};
    if (domain && !(existing.domains as string[]).includes(domain)) {
      patch.domains = [...(existing.domains as string[]), domain];
    }
    if (hints.boardToken && !existing.ats_board_token) patch.ats_board_token = hints.boardToken;
    if (Object.keys(patch).length > 0) {
      await supabase.from('companies').update(patch).eq('id', existing.id);
    }
    return { id: existing.id as string, error: null };
  }

  const { data, error } = await supabase
    .from('companies')
    .insert({
      user_id: userId,
      name: name.trim(),
      slug,
      // domains is what lets a recruiter's personal work address find this
      // company later, so it is seeded from whatever URL we have on day one.
      domains: domain ? [domain] : [],
      careers_url: hints.careersUrl ?? null,
      website: hints.website ?? null,
      ats_board_token: hints.boardToken ?? null,
      ats_type: (hints.ats as never) ?? 'unknown',
    })
    .select('id')
    .single();

  if (error || !data) return { id: '', error: error?.message ?? 'Could not create the company.' };
  return { id: data.id as string, error: null };
}

const createSchema = z.object({
  companyName: z.string().trim().min(1, 'Which company is this?'),
  title: z.string().trim().min(1, 'What is the role called?'),
  jdUrl: z.string().trim().url().optional().or(z.literal('')),
  jdText: z.string().trim().optional(),
  location: z.string().trim().optional(),
  source: z.enum(APPLICATION_SOURCES).default('portal'),
  saveAsLead: z.boolean().default(false),
  submittedAt: z.string().optional(),
  excitement: z.coerce.number().min(1).max(5).optional(),
});

export async function createRole(
  _prev: RoleFormState,
  formData: FormData,
): Promise<RoleFormState> {
  const parsed = createSchema.safeParse({
    companyName: formData.get('companyName'),
    title: formData.get('title'),
    jdUrl: formData.get('jdUrl') ?? '',
    jdText: formData.get('jdText') ?? '',
    location: formData.get('location') ?? '',
    source: formData.get('source') ?? 'portal',
    saveAsLead: formData.get('saveAsLead') === 'on',
    submittedAt: formData.get('submittedAt') ?? '',
    excitement: formData.get('excitement') || undefined,
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();
  const input = parsed.data;

  const detected = input.jdUrl ? detectPosting(input.jdUrl) : null;

  const company = await ensureCompany(supabase, user.id, input.companyName, {
    careersUrl: input.jdUrl || null,
    website: input.jdUrl || null,
    boardToken: detected?.boardToken ?? null,
    ats: detected?.vendor === 'other' || detected?.vendor === 'unknown' ? null : detected?.vendor,
  });
  if (company.error) return { error: company.error };

  const jdText = input.jdText?.trim() || null;
  const comp = jdText ? extractCompBand(jdText) : null;

  const { data: role, error: roleError } = await supabase
    .from('roles')
    .insert({
      user_id: user.id,
      company_id: company.id,
      title: input.title,
      jd_url: input.jdUrl || null,
      jd_text: jdText,
      jd_fetched_at: null,
      jd_hash: jdText ? jdHash(jdText) : null,
      jd_source: jdText ? 'manual' : null,
      ats_job_id: detected?.jobId ?? null,
      seniority: jdText ? guessSeniority(input.title, jdText) : null,
      location: input.location || null,
      work_mode: jdText ? guessWorkMode(jdText) : null,
      comp_min_cents: comp?.minCents ?? null,
      comp_max_cents: comp?.maxCents ?? null,
      comp_source: comp ? 'posted' : null,
      source: input.source,
      requirements: jdText ? extractRequirements(jdText) : null,
      requirements_extracted_at: jdText ? new Date().toISOString() : null,
    })
    .select('id')
    .single();

  if (roleError || !role) {
    if (/roles_user_jd_hash_key/.test(roleError?.message ?? '')) {
      return { error: 'You already have this exact posting saved for this company.' };
    }
    return { error: roleError?.message ?? 'Could not create the role.' };
  }

  const { data: application, error: applicationError } = await supabase
    .from('applications')
    .insert({
      user_id: user.id,
      role_id: role.id,
      source: input.source,
      created_by: 'manual',
      excitement: input.excitement ?? null,
      submitted_at: input.saveAsLead ? null : (input.submittedAt || new Date().toISOString()),
    })
    .select('id')
    .single();

  if (applicationError || !application) {
    return { error: applicationError?.message ?? 'Could not create the application.' };
  }

  if (!input.saveAsLead) {
    await supabase.from('application_events').insert({
      user_id: user.id,
      application_id: application.id,
      kind: 'submitted',
      occurred_at: input.submittedAt || new Date().toISOString(),
      source: 'manual',
      summary: 'Applied',
    });
  }

  revalidatePath('/jobs/pipeline');
  revalidatePath('/jobs/roles');
  redirect(`/jobs/roles/${role.id}`);
}

/** Fetch a posting so the form can be filled in from a pasted link. */
export async function fetchJobDescription(
  _prev: RoleFormState,
  formData: FormData,
): Promise<RoleFormState> {
  await requireUser();
  const url = String(formData.get('jdUrl') ?? '').trim();
  if (!url) return { error: 'Paste a link first.' };

  const outcome = await fetchPostingFromUrl(url);
  if (!outcome.ok) {
    // Never a silent failure: the paste box is the documented answer and the
    // reason it is being offered is shown.
    return { notice: outcome.reason };
  }

  const questions = await fetchQuestionsFromUrl(url);

  return {
    fetched: {
      title: outcome.posting.title,
      text: outcome.posting.text,
      location: outcome.posting.location,
      atsJobId: outcome.posting.atsJobId,
      boardToken: outcome.posting.boardToken,
      vendor: outcome.posting.vendor,
      questionCount: questions.ok ? questions.questions.length : 0,
    },
    notice:
      outcome.tier === 2
        ? 'Read from the page itself rather than the job board API — check the title and description.'
        : undefined,
  };
}

export async function updateRole(
  roleId: string,
  patch: {
    title?: string;
    jdText?: string | null;
    location?: string | null;
    workMode?: string | null;
    postingStatus?: string | null;
    seniority?: string | null;
  },
): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();

  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update.title = patch.title.trim();
  if (patch.location !== undefined) update.location = patch.location;
  if (patch.workMode !== undefined) update.work_mode = patch.workMode || null;
  if (patch.postingStatus !== undefined) update.posting_status = patch.postingStatus;
  if (patch.seniority !== undefined) update.seniority = patch.seniority;
  if (patch.jdText !== undefined) {
    const text = patch.jdText?.trim() || null;
    update.jd_text = text;
    update.jd_hash = text ? jdHash(text) : null;
    update.jd_source = text ? 'manual' : null;
    // The nightly board lookup's note explains an empty panel or a title-based
    // match. Once you have pasted the description yourself it explains nothing,
    // so it goes with the thing it was about.
    update.jd_lookup_note = null;
    // Requirements are extracted once per JD; changing the JD re-extracts.
    update.requirements = text ? extractRequirements(text) : null;
    update.requirements_extracted_at = text ? new Date().toISOString() : null;
  }

  const { error } = await supabase
    .from('roles')
    .update(update)
    .eq('id', roleId)
    .eq('user_id', user.id);

  if (error) return { error: error.message };
  revalidatePath(`/jobs/roles/${roleId}`);
  return { error: null };
}

/** Paste a block of questions. The path that always works. */
export async function addQuestions(
  applicationId: string,
  block: string,
): Promise<{ error: string | null; added: number }> {
  const user = await requireUser();
  const supabase = await createClient();

  const texts = splitQuestionBlock(block);
  if (texts.length === 0) return { error: 'No questions found in that paste.', added: 0 };

  let added = 0;
  for (const text of texts) {
    const fingerprint = questionFingerprint(text);

    const { data: existing } = await supabase
      .from('questions')
      .select('id, times_seen')
      .eq('user_id', user.id)
      .eq('fingerprint', fingerprint)
      .maybeSingle();

    let questionId = existing?.id as string | undefined;

    if (questionId) {
      await supabase
        .from('questions')
        .update({ times_seen: (existing!.times_seen as number) + 1 })
        .eq('id', questionId);
    } else {
      const { data: created, error } = await supabase
        .from('questions')
        .insert({
          user_id: user.id,
          text,
          fingerprint,
          kind: guessQuestionKind(text),
        })
        .select('id')
        .single();
      if (error || !created) continue;
      questionId = created.id as string;
    }

    const { error: answerError } = await supabase.from('application_answers').insert({
      user_id: user.id,
      application_id: applicationId,
      question_id: questionId,
    });
    if (!answerError) added += 1;
  }

  revalidatePath('/jobs/answers');
  return { error: null, added };
}

export async function saveAnswer(
  answerId: string,
  answer: string,
  status: 'draft' | 'approved' | 'submitted',
): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from('application_answers')
    .update({ answer, status })
    .eq('id', answerId)
    .eq('user_id', user.id);
  if (error) return { error: error.message };
  revalidatePath('/jobs/answers');
  return { error: null };
}

/**
 * Promote an approved answer to the question's canonical version.
 *
 * This is the loop that compounds: after twenty applications the common
 * questions are answered and the work per application drops to tailoring.
 */
export async function promoteToCanonical(
  questionId: string,
  answer: string,
): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from('questions')
    .update({
      canonical_answer: answer,
      canonical_answer_updated_at: new Date().toISOString(),
    })
    .eq('id', questionId)
    .eq('user_id', user.id);
  if (error) return { error: error.message };
  revalidatePath('/jobs/answers');
  return { error: null };
}

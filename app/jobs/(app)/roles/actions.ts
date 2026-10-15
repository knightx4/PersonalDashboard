'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { applyBoardToRole, resolveBoard, type CompanyForLookup, type RoleForLookup } from '@/lib/jobs/jd/lookup';
import { extractCompBand, extractRequirements, jdHash } from '@/lib/jobs/jd/requirements';
import { guessQuestionKind, questionFingerprint, splitQuestionBlock } from '@/lib/jobs/fingerprint';
import { draftAnswer } from '@/lib/jobs/evidence/draft';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import { DEFAULT_BANNED_CONSTRUCTIONS, type AnswerDraft } from '@/lib/jobs/evidence/draft-payload';
import type { RequirementMatch } from '@/lib/jobs/evidence/match-payload';
import { shortlistEvidence } from '@/lib/jobs/evidence/shortlist';

// latency: pending
export async function updateRole(
  roleId: string,
  patch: {
    title?: string;
    jdText?: string | null;
    jdUrl?: string | null;
    atsJobId?: string | null;
    location?: string | null;
    workMode?: string | null;
    postingStatus?: string | null;
    seniority?: string | null;
    compMinCents?: number | null;
    compMaxCents?: number | null;
    compSource?: 'posted' | 'recruiter' | 'estimate' | null;
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
  if (patch.jdUrl !== undefined) update.jd_url = patch.jdUrl || null;
  if (patch.atsJobId !== undefined) update.ats_job_id = patch.atsJobId || null;
  if (patch.compMinCents !== undefined) update.comp_min_cents = patch.compMinCents;
  if (patch.compMaxCents !== undefined) update.comp_max_cents = patch.compMaxCents;
  if (patch.compSource !== undefined) update.comp_source = patch.compSource;
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

    // Fill the comp band from the posting text itself -- but only when the
    // extraction actually found one, and only when this same call is not
    // already setting comp by hand. A JD with no visible range should not
    // erase a number pulled from a call with the recruiter.
    if (text && patch.compMinCents === undefined && patch.compMaxCents === undefined) {
      const comp = extractCompBand(text);
      if (comp) {
        update.comp_min_cents = comp.minCents;
        update.comp_max_cents = comp.maxCents;
        update.comp_source = 'posted';
      }
    }
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
// latency: pending
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

  revalidatePath('/jobs/material');
  return { error: null, added };
}

// latency: pending
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
  revalidatePath('/jobs/material');
  return { error: null };
}

/**
 * Take a question off this application (note 08c638c3). The question stays in
 * the bank with its default answer, since other applications may ask it; only
 * this application's answer row goes, and the count of times it was asked
 * drops by the one this application added.
 */
// latency: pending
export async function removeAnswer(answerId: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: removed, error } = await supabase
    .from('application_answers')
    .delete()
    .eq('id', answerId)
    .eq('user_id', user.id)
    .select('question_id')
    .maybeSingle();
  if (error) return { error: error.message };
  if (removed?.question_id) {
    const { data: question } = await supabase
      .from('questions')
      .select('times_seen')
      .eq('id', removed.question_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (question && (question.times_seen as number) > 1) {
      await supabase
        .from('questions')
        .update({ times_seen: (question.times_seen as number) - 1 })
        .eq('id', removed.question_id)
        .eq('user_id', user.id);
    }
  }
  revalidatePath('/jobs/roles/[id]', 'page');
  revalidatePath('/jobs/material');
  return { error: null };
}

/**
 * Promote an approved answer to the question's canonical version.
 *
 * This is the loop that compounds: after twenty applications the common
 * questions are answered and the work per application drops to tailoring.
 */
// latency: pending
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
  revalidatePath('/jobs/material');
  return { error: null };
}

/** What the role page shows after a lookup. */
export interface JdLookupResult {
  ok: boolean;
  message: string;
  /** Set only when the board offered more than one plausible posting. */
  candidates?: Array<{ title: string; url: string | null }>;
}

/**
 * Read this role's description off the employer's board, now.
 *
 * The same work the nightly backfill does, on one role, on your session rather
 * than the service key -- so RLS decides what is yours, not this function. The
 * point of it existing at all is the queue: the nightly pass walks six
 * companies a night, and a role you care about today should not wait its turn
 * behind two hundred you do not.
 *
 * Refuses a role that already has a description. The button is only offered on
 * an empty one, but the rule that automated work never overwrites what a person
 * wrote belongs here, where it cannot be got round by a stale page.
 */
// latency: pending
export async function lookUpJobDescription(roleId: string): Promise<JdLookupResult> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: role, error } = await supabase
    .from('roles')
    .select(
      `id, user_id, company_id, title, jd_text, ats_job_id, location, work_mode, seniority,
       comp_min_cents, comp_max_cents, jd_url, posting_status,
       companies!inner ( id, name, ats_type, ats_board_token, ats_board_hint, careers_url, website )`,
    )
    .eq('id', roleId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) return { ok: false, message: error.message };
  if (!role) return { ok: false, message: 'That role could not be found.' };
  if ((role.jd_text as string | null)?.trim()) {
    return { ok: false, message: 'This role already has a description. Edit it instead.' };
  }

  const company = role.companies as unknown as CompanyForLookup | null;
  if (!company) return { ok: false, message: 'That role has no company to look up a board for.' };

  // Every title at this company, not just this one: a guessed board is only
  // believed when a posting on it matches a role recorded here, and one title
  // is a thinner test than four.
  const { data: siblings } = await supabase
    .from('roles')
    .select('title')
    .eq('user_id', user.id)
    .eq('company_id', role.company_id as string)
    .limit(50);

  const now = new Date();
  const resolved = await resolveBoard(
    supabase,
    await createCoreClient(),
    company,
    user.id,
    (siblings ?? []).map((row) => row.title as string),
    now,
  );

  revalidatePath(`/jobs/roles/${roleId}`);

  if (!resolved.ok) return { ok: false, message: resolved.reason };

  const outcome = await applyBoardToRole(
    supabase,
    role as unknown as RoleForLookup,
    resolved.board,
    now,
  );

  revalidatePath(`/jobs/roles/${roleId}`);

  switch (outcome.kind) {
    case 'filled':
      return { ok: true, message: `Read from the ${outcome.vendor} board: “${outcome.title}”.` };
    case 'ambiguous':
      return {
        ok: false,
        message: `More than one posting on the ${outcome.vendor} board could be this role. Open the one that is yours and paste it, rather than have the wrong description saved here.`,
        candidates: outcome.candidates,
      };
    case 'closed':
      return {
        ok: false,
        message: `Not on the ${outcome.vendor} board any more, so the posting has closed and its description is no longer published.`,
      };
    case 'no_match':
      return { ok: false, message: `No posting on the ${outcome.vendor} board matched this role.` };
    case 'untitled':
      return {
        ok: false,
        message: 'This role still has no title, so there is nothing to match against the board.',
      };
    case 'no_description':
      return {
        ok: false,
        message: `Found the posting on the ${outcome.vendor} board, but it publishes no description.`,
      };
    case 'save_failed':
      return { ok: false, message: outcome.note };
  }
}

/**
 * Drafting one answer: the best answer to the question, drawing on the bank
 * and the posting (note ad554975).
 *
 * The draft comes back to the caller and is not written anywhere. It lands
 * beside the textarea, not in it, and only an Insert followed by a Save puts
 * it on the record — the compose.ts principle carried forward: the model may
 * prepare text, but nothing goes out over your name that you did not put
 * there.
 */
const draftSchema = z.object({ answerId: z.string().uuid() });

// latency: pending
export async function draftAnswerFromEvidence(
  input: z.input<typeof draftSchema>,
): Promise<{ draft: AnswerDraft | null; error: string | null }> {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return { draft: null, error: parsed.error.issues[0].message };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { draft: null, error: 'Drafting is not configured.' };

  const user = await requireUser();
  const supabase = await createClient();

  const { data: row, error: rowError } = await supabase
    .from('application_answers')
    .select(
      `id, word_limit,
       questions!application_answers_question_id_fkey!inner ( text, canonical_answer ),
       applications!inner ( roles!inner ( title, jd_text, requirement_matches, companies!inner ( name ) ) )`,
    )
    .eq('id', parsed.data.answerId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (rowError) return { draft: null, error: rowError.message };
  if (!row) return { draft: null, error: 'That question is not yours.' };

  const question = row.questions as unknown as { text: string; canonical_answer: string | null };
  const role = (row.applications as unknown as {
    roles: {
      title: string;
      jd_text: string | null;
      requirement_matches: RequirementMatch[] | null;
      companies: { name: string } | null;
    };
  }).roles;

  const [{ data: bank, error: bankError }, { data: profile }] = await Promise.all([
    supabase
      .from('evidence_items')
      .select('id, title, body, context, metrics, skills, strength')
      .eq('user_id', user.id),
    supabase
      .from('profiles')
      .select('writing_style_notes, banned_constructions')
      .eq('id', user.id)
      .maybeSingle(),
  ]);

  if (bankError) return { draft: null, error: bankError.message };

  const items = (bank ?? []).map((item) => ({
    id: item.id as string,
    title: item.title as string,
    body: item.body as string,
    context: (item.context as string) ?? null,
    metrics: (item.metrics as string) ?? null,
    skills: (item.skills as string[]) ?? [],
    strength: item.strength as number,
  }));


  // The shortlist is against the question rather than the description: this
  // one answer is about one thing, and sending the whole bank invites the
  // model to reach for a stronger story that answers a different question.
  const shortlist = shortlistEvidence([{ text: question.text, kind: 'must_have' }], items);

  // What the match already established this role wants, so the draft is
  // written toward the role rather than in the abstract. Absent until the
  // requirements have been matched, which is fine.
  const matches = (role.requirement_matches as RequirementMatch[] | null) ?? [];
  const wants = matches
    .filter((match) => match.kind === 'must_have')
    .slice(0, 8)
    .map((match) => match.requirement)
    .join('; ');

  const banned = (profile?.banned_constructions as string[] | null) ?? [];

  const spend: SpendReport[] = [];
  const result = await draftAnswer(
    { apiKey, onSpend: (report) => spend.push(report) },
    {
      question: question.text,
      roleLabel: [role.companies?.name, role.title].filter(Boolean).join(', '),
      bank: shortlist,
      wordLimit: (row.word_limit as number) ?? null,
      styleNotes: (profile?.writing_style_notes as string) ?? null,
      banned: banned.length > 0 ? banned : DEFAULT_BANNED_CONSTRUCTIONS,
      canonicalAnswer: question.canonical_answer,
      requirementSummary: wants || null,
      posting: role.jd_text,
    },
  );
  await recordSessionSpend(user.id, { module: 'jobs', operation: 'draft-answer' }, spend);

  if (!result.ok) return { draft: null, error: result.error };
  return { draft: result.draft, error: null };
}

const acceptDraftSchema = z.object({
  answerId: z.string().uuid(),
  answer: z.string().trim().min(1),
  evidenceItemIds: z.array(z.string().uuid()).max(40),
  unsupportedClaims: z.array(z.string().trim().min(1)).max(20),
});

/**
 * Save an answer that came from a draft, recording what it cited.
 *
 * Separate from `saveAnswer` because the citation is the point: an answer with
 * `evidence_item_ids` can be traced back to the stories it rests on months
 * later, and `unsupported_claims` is what you re-read before you submit. The
 * used counters go up here rather than at draft time, so a draft you discarded
 * does not make a story look worn out.
 */
// latency: pending
export async function saveDraftedAnswer(
  input: z.input<typeof acceptDraftSchema>,
): Promise<{ error: string | null }> {
  const parsed = acceptDraftSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('application_answers')
    .update({
      answer: parsed.data.answer,
      status: 'draft',
      evidence_item_ids: parsed.data.evidenceItemIds,
      unsupported_claims: parsed.data.unsupportedClaims,
    })
    .eq('id', parsed.data.answerId)
    .eq('user_id', user.id);

  if (error) return { error: error.message };

  // Best effort: a use counter that failed to tick is not a reason to lose the
  // answer that was just saved.
  if (parsed.data.evidenceItemIds.length > 0) {
    await supabase.rpc('bump_evidence_use', { item_ids: parsed.data.evidenceItemIds });
  }

  revalidatePath('/jobs/material');
  return { error: null };
}

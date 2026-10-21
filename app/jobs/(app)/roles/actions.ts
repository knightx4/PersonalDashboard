'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { applyBoardToRole, resolveBoard, type CompanyForLookup, type RoleForLookup } from '@/lib/jobs/jd/lookup';
import { descriptionUpdate, saveRoleEdit } from '@/lib/jobs/roles/edit';
import { countEvidenceUse, saveAnswerEdit, setCanonicalAnswer } from '@/lib/jobs/answers/edit';
import { recordHandEditOrigins } from '@/lib/jobs/fact-origins';
import { isRoleKind } from '@/lib/jobs/role-kind';
import { guessQuestionKind, questionFingerprint, splitQuestionBlock } from '@/lib/jobs/fingerprint';
import type { AnswerDraft } from '@/lib/jobs/evidence/draft-payload';
import {
  draftAnswerFor,
  draftApplicationAs,
  type DraftApplicationResult,
} from '@/lib/jobs/drafting/run-draft';
import { dropDraft, saveReplies, type StoredAsk } from '@/lib/jobs/drafting/store';

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
    kind?: string;
  },
): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();

  const update: Record<string, unknown> = {};
  let payFromPosting = false;
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
  if (patch.kind !== undefined) {
    if (!isRoleKind(patch.kind)) return { error: 'That is not a kind of role.' };
    update.kind = patch.kind;
  }
  if (patch.jdText !== undefined) {
    const read = descriptionUpdate(patch.jdText, patch.compMinCents !== undefined || patch.compMaxCents !== undefined);
    Object.assign(update, read.update);
    payFromPosting = read.payFromPosting;
  }

  // What the facts were, so only the ones this save changes get an origin:
  // the posting form sends the pay on every save.
  const { data: before } = await supabase
    .from('roles')
    .select('location, work_mode, seniority, posting_status, comp_min_cents, comp_max_cents, comp_source')
    .eq('id', roleId)
    .eq('user_id', user.id)
    .maybeSingle();

  const { error } = await saveRoleEdit(supabase, user.id, roleId, update);

  if (error) return { error: error.message };
  if (before) await recordHandEditOrigins(supabase, user.id, roleId, before, update, { payFromPosting });
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
  const { error } = await saveAnswerEdit(supabase, user.id, answerId, { answer, status });
  if (error) return { error };
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
  const { error } = await setCanonicalAnswer(supabase, user.id, questionId, answer);
  if (error) return { error };
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
 * Since plan #2130.3 it is the whole-application drafter asked for one
 * question, so a single draft reads everything on file, sees the other
 * answers, and uses the replies to Dash's earlier asks. The draft lands beside
 * the textarea, not in it, and only an Insert followed by a Save puts it on
 * the record: the compose.ts principle carried forward, the model may prepare
 * text, but nothing goes out over your name that you did not put there. It is
 * also kept in application_drafts with the rest of the application's drafts.
 */
const draftSchema = z.object({ answerId: z.string().uuid() });

// latency: pending
export async function draftAnswerFromEvidence(
  input: z.input<typeof draftSchema>,
): Promise<{
  draft: AnswerDraft | null;
  /** Dash's questions on the application after this run, so the tab can show a new one (plan #2130.4). */
  asks?: StoredAsk[];
  error: string | null;
}> {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return { draft: null, error: parsed.error.issues[0].message };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { draft: null, error: 'Drafting is not configured.' };

  const user = await requireUser();
  const result = await draftAnswerFor(user.id, apiKey, parsed.data.answerId);
  return { draft: result.draft, asks: result.asks, error: result.error };
}

/**
 * Drafting every answer on an application in one call (plan #2130.3), or the
 * ones named. Dash reads everything on file (gather), writes the answers
 * together so they tell different stories, checks each against its limit,
 * and lists what it needs to ask. Replies to its earlier asks are saved
 * first, so the drafts use them.
 *
 * The result is stored in application_drafts, a working copy: as with the
 * single draft, only an Insert and a Save put an answer on the record.
 */
const draftApplicationSchema = z.object({
  applicationId: z.string().uuid(),
  /** Absent or empty: every question with no answer. */
  answerIds: z.array(z.string().uuid()).max(100).optional(),
  /** Replies to Dash's asks, by ask id; an empty reply clears one. */
  replies: z.record(z.string(), z.string().max(4_000)).optional(),
});

export type { DraftApplicationResult };

// latency: pending
export async function draftApplication(
  input: z.input<typeof draftApplicationSchema>,
): Promise<DraftApplicationResult> {
  const parsed = draftApplicationSchema.safeParse(input);
  if (!parsed.success) {
    return { drafts: null, drafted: [], flagged: [], missing: [], error: parsed.error.issues[0].message };
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { drafts: null, drafted: [], flagged: [], missing: [], error: 'Drafting is not configured.' };

  const user = await requireUser();
  return draftApplicationAs(user.id, apiKey, parsed.data);
}

const answerRepliesSchema = z.object({
  applicationId: z.string().uuid(),
  replies: z.record(z.string(), z.string().max(4_000)),
});

/**
 * Keeps the person's replies to Dash's questions about the answers without
 * redrafting (plan #2130.4), so a reply typed and left survives a reload and
 * the next run uses it. An empty reply clears it.
 */
// latency: pending
export async function saveAnswerReplies(
  input: z.input<typeof answerRepliesSchema>,
): Promise<{ error: string | null }> {
  const parsed = answerRepliesSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  await requireUser();
  const supabase = await createClient();
  const { saved, error } = await saveReplies(supabase, parsed.data.applicationId, 'answers', parsed.data.replies);
  if (error) return { error };
  if (!saved) return { error: 'There are no drafts to reply to.' };
  return { error: null };
}

const dropAnswerDraftSchema = z.object({ answerId: z.string().uuid() });

/**
 * Takes an answer's draft out of the application's stored drafts once it has
 * been inserted or discarded (plan #2130.4), so a reload does not offer it
 * again. Dash's questions and their replies stay.
 */
// latency: pending
export async function dropAnswerDraft(
  input: z.input<typeof dropAnswerDraftSchema>,
): Promise<{ error: string | null }> {
  const parsed = dropAnswerDraftSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();
  const { data: row, error: rowError } = await supabase
    .from('application_answers')
    .select('application_id')
    .eq('id', parsed.data.answerId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (rowError) return { error: rowError.message };
  if (!row) return { error: 'That question is not yours.' };

  return dropDraft(supabase, row.application_id as string, 'answers', parsed.data.answerId);
}

const acceptDraftSchema = z.object({
  answerId: z.string().uuid(),
  answer: z.string().trim().min(1),
  evidenceItemIds: z.array(z.string().uuid()).max(40),
  unsupportedClaims: z.array(z.string().trim().min(1)).max(20),
  considerations: z.array(z.string().trim().min(1)).max(10).default([]),
});

/**
 * Save an answer that came from a draft, recording what it cited.
 *
 * Separate from `saveAnswer` because the citation is the point: an answer with
 * `evidence_item_ids` can be traced back to the stories it rests on months
 * later, and `considerations` is how to approach the question, re-read before
 * you submit (it took over from `unsupported_claims`, still written). The
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

  const { error } = await saveAnswerEdit(supabase, user.id, parsed.data.answerId, {
    answer: parsed.data.answer,
    status: 'draft',
    evidence_item_ids: parsed.data.evidenceItemIds,
    unsupported_claims: parsed.data.unsupportedClaims,
    considerations: parsed.data.considerations,
  });

  if (error) return { error };

  // Best effort: a use counter that failed to tick is not a reason to lose the
  // answer that was just saved.
  await countEvidenceUse(supabase, parsed.data.evidenceItemIds);

  revalidatePath('/jobs/material');
  return { error: null };
}

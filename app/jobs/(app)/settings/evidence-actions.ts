'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { proposeEvidenceFromSource } from '@/lib/jobs/evidence/propose';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import {
  MAX_CANDIDATES,
  normalizeSkills,
  type EvidenceCandidate,
  type EvidenceSourceKind,
} from '@/lib/jobs/evidence/propose-payload';
import {
  EMPTY_SOURCE_REASON,
  assembleAnswersSource,
  assembleDebriefsSource,
  assembleResumeSource,
} from '@/lib/jobs/evidence/sources';

/**
 * The evidence bank.
 *
 * Seed this before building generation. The quality ceiling of every draft the
 * app will ever produce is set here, and no prompt engineering compensates for
 * an empty bank — which is why the editor ships in the MVP even though
 * generation does not.
 */
const evidenceSchema = z.object({
  title: z.string().trim().min(1, 'Give it a short handle.').max(160),
  body: z.string().trim().min(1, 'Write the story in your own words.'),
  context: z.string().trim().max(400).optional(),
  skills: z.string().trim().optional(),
  metrics: z.string().trim().max(400).optional(),
  strength: z.coerce.number().int().min(1).max(5).default(3),
});

// latency: pending
export async function addEvidence(
  _prev: { error?: string; message?: string },
  formData: FormData,
): Promise<{ error?: string; message?: string }> {
  const parsed = evidenceSchema.safeParse({
    title: formData.get('title'),
    body: formData.get('body'),
    context: formData.get('context') ?? '',
    skills: formData.get('skills') ?? '',
    metrics: formData.get('metrics') ?? '',
    strength: formData.get('strength') ?? 3,
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase.from('evidence_items').insert({
    user_id: user.id,
    title: parsed.data.title,
    body: parsed.data.body,
    context: parsed.data.context || null,
    metrics: parsed.data.metrics || null,
    strength: parsed.data.strength,
    skills: (parsed.data.skills ?? '')
      .split(/[,\n]/)
      .map((entry) => entry.trim().toLowerCase().replace(/\s+/g, '_'))
      .filter(Boolean),
  });

  if (error) return { error: error.message };
  revalidatePath('/jobs/settings');
  return { message: 'Added.' };
}

// latency: pending
export async function deleteEvidence(id: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from('evidence_items')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) return { error: error.message };
  revalidatePath('/jobs/settings');
  return { error: null };
}

const resumeSchema = z.object({
  label: z.string().trim().min(1, 'Give the version a label.').max(60),
  notes: z.string().trim().max(400).optional(),
  textContent: z.string().trim().optional(),
});

// latency: pending
export async function addResumeVersion(
  _prev: { error?: string; message?: string },
  formData: FormData,
): Promise<{ error?: string; message?: string }> {
  const parsed = resumeSchema.safeParse({
    label: formData.get('label'),
    notes: formData.get('notes') ?? '',
    textContent: formData.get('textContent') ?? '',
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase.from('resume_versions').insert({
    user_id: user.id,
    label: parsed.data.label,
    notes: parsed.data.notes || null,
    text_content: parsed.data.textContent || null,
  });

  if (error) {
    return {
      error: /resume_versions_user_label_key/.test(error.message)
        ? 'You already have a version with that label.'
        : error.message,
    };
  }

  revalidatePath('/jobs/settings');
  return { message: 'Added. Point applications at it so you can see which version gets past resume review.' };
}

/**
 * Seeding the bank from material you have already written.
 *
 * Propose then apply, the same shape as the company lookup: candidates are
 * shown, edited if you like, and only the ones you tick are inserted. Nothing
 * a model wrote reaches the bank without a click, because a bad item does not
 * announce itself — it just quietly degrades every match and every draft built
 * on top of it.
 */
const proposeSchema = z.object({
  kind: z.enum(['resume', 'answers', 'debriefs']),
  /** Required for `resume`; which version to read. */
  resumeVersionId: z.string().uuid().optional(),
});

// latency: pending
export async function proposeEvidence(
  input: z.input<typeof proposeSchema>,
): Promise<{
  proposal: { kind: EvidenceSourceKind; candidates: EvidenceCandidate[] } | null;
  error: string | null;
}> {
  const parsed = proposeSchema.safeParse(input);
  if (!parsed.success) return { proposal: null, error: parsed.error.issues[0].message };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { proposal: null, error: 'AI proposals are not configured.' };

  const { kind } = parsed.data;
  const user = await requireUser();
  const supabase = await createClient();

  let text = '';

  if (kind === 'resume') {
    if (!parsed.data.resumeVersionId) {
      return { proposal: null, error: 'Pick a resume version to read.' };
    }
    const { data: resume, error } = await supabase
      .from('resume_versions')
      .select('text_content')
      .eq('id', parsed.data.resumeVersionId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) return { proposal: null, error: error.message };
    if (!resume) return { proposal: null, error: 'That resume version is not yours.' };
    text = assembleResumeSource((resume.text_content as string) ?? null);
  }

  if (kind === 'answers') {
    // Behavioural only: a "why this company" answer is about the employer, and
    // banking it as evidence about you is how the bank fills up with prose
    // that no requirement will ever match.
    const { data: rows, error } = await supabase
      .from('application_answers')
      .select('answer, questions!inner (text, kind)')
      .eq('user_id', user.id)
      .eq('status', 'approved')
      .eq('questions.kind', 'behavioral')
      .order('updated_at', { ascending: false })
      .limit(40);
    if (error) return { proposal: null, error: error.message };
    text = assembleAnswersSource(
      (rows ?? []).map((row) => {
        const question = row.questions as unknown as { text: string } | null;
        return { question: question?.text ?? '', answer: (row.answer as string) ?? '' };
      }),
    );
  }

  if (kind === 'debriefs') {
    const { data: rows, error } = await supabase
      .from('interviews')
      .select(
        'debrief, went_well, went_poorly, applications!inner (roles!inner (title, companies!inner (name)))',
      )
      .eq('user_id', user.id)
      .order('scheduled_at', { ascending: false, nullsFirst: false })
      .limit(40);
    if (error) return { proposal: null, error: error.message };
    text = assembleDebriefsSource(
      (rows ?? []).map((row) => {
        const application = row.applications as unknown as {
          roles: { title: string; companies: { name: string } | null } | null;
        } | null;
        const role = application?.roles ?? null;
        const label = role ? [role.companies?.name, role.title].filter(Boolean).join(', ') : null;
        return {
          label: label || null,
          debrief: (row.debrief as string) ?? null,
          wentWell: (row.went_well as string) ?? null,
          wentPoorly: (row.went_poorly as string) ?? null,
        };
      }),
    );
  }

  if (!text) return { proposal: null, error: EMPTY_SOURCE_REASON[kind] };

  const { data: existing } = await supabase
    .from('evidence_items')
    .select('title')
    .eq('user_id', user.id)
    .limit(60);

  const spend: SpendReport[] = [];
  const result = await proposeEvidenceFromSource(
    { apiKey, onSpend: (report) => spend.push(report) },
    { kind, text, existingTitles: (existing ?? []).map((item) => item.title as string) },
  );
  await recordSessionSpend(user.id, { module: 'jobs', operation: 'propose-evidence' }, spend);
  if (!result.ok) return { proposal: null, error: result.error };

  return { proposal: { kind, candidates: result.candidates }, error: null };
}

const acceptSchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(160),
        body: z.string().trim().min(1),
        context: z.string().trim().max(400).nullable(),
        metrics: z.string().trim().max(400).nullable(),
        skills: z.array(z.string().trim().min(1)).max(8),
        strength: z.number().int().min(1).max(5),
      }),
    )
    .min(1, 'Tick at least one to add.')
    .max(MAX_CANDIDATES),
});

/**
 * Insert the candidates that were ticked. Re-validated here rather than
 * trusted from the proposal, because the list travelled through a form the
 * user could edit — which is the point of showing it.
 */
// latency: pending
export async function acceptEvidence(
  input: z.input<typeof acceptSchema>,
): Promise<{ added: number; error: string | null }> {
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) return { added: 0, error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase.from('evidence_items').insert(
    parsed.data.items.map((item) => ({
      user_id: user.id,
      title: item.title,
      body: item.body,
      context: item.context || null,
      metrics: item.metrics || null,
      strength: item.strength,
      skills: normalizeSkills(item.skills),
    })),
  );

  if (error) return { added: 0, error: error.message };

  revalidatePath('/jobs/settings');
  return { added: parsed.data.items.length, error: null };
}

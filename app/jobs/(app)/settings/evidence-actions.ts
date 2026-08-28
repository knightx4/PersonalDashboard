'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';

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

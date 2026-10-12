'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { parseWordTarget } from '@/lib/learn/essays/model';
import { saveDraft, saveWordTarget } from '@/lib/learn/essays/store';

/**
 * The editor's two writes (plan #1865). The draft saves as you type, so its
 * action answers with a result rather than throwing: the editor keeps the
 * text either way and says when a save failed.
 */

export type DraftSaveResult = { ok: true; savedAt: string } | { ok: false; error: string };

const DraftInput = z.object({
  id: z.string().uuid(),
  // The longest essay the spec has in mind is about 2,000 words; this is far
  // past it and only stops a runaway paste.
  body: z.string().max(400_000, 'The draft is too long to save.'),
});

// latency: optimistic
export async function saveEssayDraft(id: string, body: string): Promise<DraftSaveResult> {
  await requireUser();
  const parsed = DraftInput.safeParse({ id, body });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Could not save.' };
  try {
    const supabase = await createLearnClient();
    const { updatedAt } = await saveDraft(supabase, parsed.data.id, parsed.data.body);
    return { ok: true, savedAt: updatedAt };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not save.' };
  }
}

export type TargetState = { error?: string; target?: number | null };

// latency: pending
export async function setEssayWordTarget(_prev: TargetState, formData: FormData): Promise<TargetState> {
  await requireUser();
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Could not find that essay.' };
  const parsed = parseWordTarget(String(formData.get('target') ?? ''));
  if ('error' in parsed) return { error: parsed.error };
  try {
    const supabase = await createLearnClient();
    await saveWordTarget(supabase, id.data, parsed.target);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not set the target.' };
  }
  revalidatePath('/learn/essays');
  return { target: parsed.target };
}

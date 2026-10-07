'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';

export interface VoiceState {
  error?: string;
  message?: string;
}

const voiceSchema = z.object({
  writingStyleNotes: z.string().trim().max(4000),
  bannedConstructions: z.string().trim(),
});

/**
 * Your writing voice: how you want to sound, and the phrases no draft may use.
 *
 * It used to be saved by the Settings form along with the search dates and
 * titles. It is material every draft reads, so it is saved here on its own,
 * and the Settings form no longer writes these two columns at all: a form
 * that does not show a field must not be able to clear it.
 */
// latency: pending
export async function updateWritingVoice(_prev: VoiceState, formData: FormData): Promise<VoiceState> {
  const parsed = voiceSchema.safeParse({
    writingStyleNotes: formData.get('writingStyleNotes') ?? '',
    bannedConstructions: formData.get('bannedConstructions') ?? '',
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('profiles')
    .update({
      writing_style_notes: parsed.data.writingStyleNotes || null,
      banned_constructions: parsed.data.bannedConstructions
        .split('\n')
        .map((entry) => entry.trim())
        .filter(Boolean),
    })
    .eq('id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/jobs/material');
  return { message: 'Saved.' };
}

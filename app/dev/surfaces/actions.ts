'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient, requireUser } from '@/lib/auth/server';
import { surfacePath } from '@/lib/feedback/surfaces';

/**
 * A note about how a surface looks, filed into the one queue.
 *
 * Deliberately the same table as every bug report and feature request rather
 * than a table of its own. There is already a queue, a script that reads it
 * and a skill that works it; a second inbox would mean a second thing to
 * remember to check, and the one that got checked less would quietly become
 * the one that mattered less.
 *
 * The surface goes in `page_path` as `/preview?s=<id>`. That column's own
 * comment in migration 0026 reads "where the user was standing when they hit
 * the problem", which is exactly true here, so it needs no new column and no
 * new idea -- and `scripts/notes.ts` already prints it.
 */
export type SurfaceNoteState = { error?: string; message?: string };

const schema = z.object({
  surface: z
    .string()
    .regex(/^[\w-]+$/, 'not a surface')
    .max(80),
  body: z.string().trim().min(3).max(4000),
});

export async function noteOnSurface(
  _prev: SurfaceNoteState,
  formData: FormData,
): Promise<SurfaceNoteState> {
  const user = await requireUser();
  const supabase = await createClient();

  const parsed = schema.safeParse({
    surface: String(formData.get('surface') ?? ''),
    body: String(formData.get('body') ?? ''),
  });
  if (!parsed.success) return { error: 'Write a sentence about what is wrong.' };

  const { error } = await supabase.from('feedback_items').insert({
    user_id: user.id,
    // A note about how a surface reads is a request for a change, not a report
    // that something is broken. `bug` is reserved for things that do not work.
    kind: 'feature',
    body: parsed.data.body,
    page_path: surfacePath(parsed.data.surface),
  });
  if (error) return { error: error.message };

  revalidatePath('/dev/surfaces');
  revalidatePath('/dev/bugs');
  return { message: 'Noted. It is in the queue.' };
}

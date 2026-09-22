'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/auth/server';
import { requireOwner } from '@/lib/dev/owner';
import { MODULE_IDS } from '@/lib/modules';

/**
 * Writing the vision for a workspace.
 *
 * The one thing on the specs page the app may write. Everything else there is
 * read from `docs/` and is the repository's, for the reasons migration 0087
 * gives; this is the person's own paragraph about what a workspace is for, and
 * a paragraph you have to open an editor and land a commit to change is a
 * paragraph that goes stale.
 *
 * Saving nothing is how one is taken back. The row is deleted rather than left
 * holding an empty string, so "has a vision been written" stays a question
 * about rows.
 */

export type VisionActionState = {
  error?: string;
  message?: string;
};

const moduleSchema = z
  .string()
  .trim()
  .refine((value) => (MODULE_IDS as readonly string[]).includes(value), {
    message: 'That is not a workspace.',
  });

/**
 * Longer than this is not the highest layer of abstraction over a workspace;
 * it is another spec, and the specs live in the repository. The same ceiling
 * the table's own check holds, said here so the reason arrives as a sentence
 * rather than as a constraint violation.
 */
const bodySchema = z.string().trim().max(8000, 'A vision shorter than the specs under it.');

// latency: pending
export async function saveModuleVision(
  _prev: VisionActionState,
  formData: FormData,
): Promise<VisionActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const scope = moduleSchema.safeParse(String(formData.get('module') ?? ''));
  const body = bodySchema.safeParse(formData.get('body') ?? '');
  if (!scope.success) return { error: scope.error.issues[0].message };
  if (!body.success) return { error: body.error.issues[0].message };

  if (body.data === '') {
    const { error } = await supabase
      .from('module_visions')
      .delete()
      .eq('user_id', user.id)
      .eq('module', scope.data);
    if (error) return { error: error.message };

    revalidatePath('/dev/specs');
    return { message: 'Vision cleared.' };
  }

  const { error } = await supabase
    .from('module_visions')
    .upsert(
      { user_id: user.id, module: scope.data, body: body.data },
      { onConflict: 'user_id,module' },
    );
  if (error) return { error: error.message };

  revalidatePath('/dev/specs');
  return { message: 'Vision saved.' };
}

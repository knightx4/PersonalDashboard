'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { PAIRS_HREF } from '@/lib/learn/map/idea-pairs';

/**
 * Settling one pair of ideas (plan #2147.2). Both run only on the person's
 * press: closeness found the pair, and they decide what it is. The work is
 * in the database functions (migrations-learn 0153 and 0154), which check
 * both ideas are the caller's own and do it in one transaction.
 */

const Similarity = z.coerce.number().min(0).max(1);
const MergeInput = z.object({ keep: z.string().uuid(), retire: z.string().uuid(), similarity: Similarity });
const KeepInput = z.object({ a: z.string().uuid(), b: z.string().uuid(), similarity: Similarity });

type Result = { ok: false; error: string };

function settled(): never {
  revalidatePath('/learn/space');
  revalidatePath(PAIRS_HREF);
  redirect(PAIRS_HREF);
}

// latency: pending -- the pair's page is gone once it is merged, so the list opens when it is done
/** Merge `retire` into `keep`: one idea with both subjects' answers. */
export async function mergeIdeasAction(form: FormData): Promise<Result | void> {
  const parsed = MergeInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: 'That pair could not be read.' };
  await requireUser();
  const learn = await createLearnClient();
  const { error } = await learn.rpc('merge_ideas', {
    p_keep: parsed.data.keep,
    p_retire: parsed.data.retire,
    p_similarity: parsed.data.similarity,
  });
  if (error) return { ok: false, error: `Merging them failed: ${error.message}` };
  settled();
}

// latency: pending -- the pair leaves the list once it is kept, so the list opens when it is done
/** Keep both ideas, carrying a tested result across as inferred. */
export async function keepBothIdeasAction(form: FormData): Promise<Result | void> {
  const parsed = KeepInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: 'That pair could not be read.' };
  await requireUser();
  const learn = await createLearnClient();
  const { error } = await learn.rpc('keep_both_ideas', {
    p_a: parsed.data.a,
    p_b: parsed.data.b,
    p_similarity: parsed.data.similarity,
  });
  if (error) return { ok: false, error: `Keeping both failed: ${error.message}` };
  settled();
}

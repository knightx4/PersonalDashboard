'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { recordOutcome } from '@/lib/learn/next/record';

/**
 * Pushing a row aside.
 *
 * The one signal on this page that is not you finishing something, and #479
 * settled that it is a button rather than something inferred: the app never
 * decides you have lost interest from what you did or did not press. The row
 * drops to the back of its kind for a few weeks and says so when it comes
 * back, which `lib/learn/next/rank.ts` does with what this writes.
 *
 * The ids come from the form and are not trusted for ownership. The insert
 * goes through the session client, so RLS decides whether there is a claim or
 * a reading there at all.
 */
const PushedAside = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['ready', 'recheck']), conceptId: z.string().uuid() }),
  z.object({ kind: z.literal('reading'), readingId: z.string().uuid() }),
]);

export async function pushAside(formData: FormData): Promise<void> {
  const user = await requireUser();

  const parsed = PushedAside.safeParse({
    kind: formData.get('kind'),
    conceptId: formData.get('conceptId') ?? undefined,
    readingId: formData.get('readingId') ?? undefined,
  });
  // Nothing to say to the person: the form is three hidden fields it wrote
  // itself, so a bad one is a broken page rather than a mistake they made.
  if (!parsed.success) return;

  const supabase = await createLearnClient();
  await recordOutcome(supabase, user.id, { ...parsed.data, outcome: 'not_now' });

  revalidatePath('/learn/next');
  // The tab's badge counts the rows this page would show, and one of them has
  // just moved.
  revalidatePath('/learn');
}

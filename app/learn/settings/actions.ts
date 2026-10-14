'use server';

import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { isTeachBackRate } from '@/lib/learn/feed/teach-back';
import { saveTeachBackEvery } from '@/lib/learn/feed/teach-back-store';
import { saveOfferSubjects } from '@/lib/learn/offer-setting';

/**
 * Learn settings' writes (plan #1937.10). Each answers `{ error }` when it
 * refuses, which the field shows in the toast.
 */

/** Whether Subjects and Practice offer a subject built from a theme in your notes. */
// latency: optimistic
export async function setOfferSubjects(on: boolean): Promise<{ error?: string }> {
  const user = await requireUser();
  if (typeof on !== 'boolean') return { error: 'That is not a setting here.' };
  try {
    await saveOfferSubjects(await createLearnClient(), user.id, on);
    return {};
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : 'Could not keep that.' };
  }
}

/** How often Now asks for a teach-back, as the select's value: "10", or "0" for never. */
// latency: optimistic
export async function setTeachBackRate(value: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const every = Number(value);
  if (!isTeachBackRate(every)) return { error: 'That is not one of the choices.' };
  try {
    await saveTeachBackEvery(await createLearnClient(), user.id, every);
    return {};
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : 'Could not keep that.' };
  }
}

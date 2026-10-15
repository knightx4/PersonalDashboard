'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadGradeMap } from '@/lib/learn/levels/loader-grade';
import { runSummary } from '@/lib/learn/levels/run';
import { declineThemeLens, loadThemeOffers, makeThemeLens } from '@/lib/learn/levels/theme-offer-store';
import { createVaultClient } from '@/lib/vault/auth/server';

/**
 * The two presses on the lens offered at the end of a run (plan #2138.14).
 * The offer is worked out again here from the run's start, so the topics and
 * levels are the ones the run missed and not what the form says.
 */

const Form = z.object({ themeId: z.string().uuid(), since: z.string().datetime() });

function read(formData: FormData) {
  return Form.safeParse({ themeId: formData.get('themeId'), since: formData.get('since') });
}

// latency: pending
export async function makeLensFromTheme(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = read(formData);
  if (!parsed.success) return;
  const [learn, vault] = await Promise.all([createLearnClient(), createVaultClient()]);
  const map = await loadGradeMap(learn, user.id);
  const { missed } = runSummary({ map, since: parsed.data.since, answered: 0 });
  const offer = (await loadThemeOffers(learn, vault, user.id, missed)).find((o) => o.themeId === parsed.data.themeId);
  if (!offer) {
    revalidatePath('/learn/now');
    return;
  }
  const lensId = await makeThemeLens(learn, user.id, offer);
  revalidatePath('/learn/now');
  redirect(`/learn/lens/${lensId}`);
}

// latency: pending
export async function declineLensFromTheme(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = read(formData);
  if (!parsed.success) return;
  const learn = await createLearnClient();
  await declineThemeLens(learn, user.id, parsed.data.themeId);
  revalidatePath('/learn/now');
}

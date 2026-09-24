'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/server';
import { createNewsClient } from '@/lib/news/auth/server';
import { readTopic } from '@/lib/news/issues/topics';
import { showTopic } from '@/lib/news/quick/hidden-topics';
import { loadOrCreateLocalPart, replaceLocalPart } from '@/lib/news/settings/address';
import { readLocalArea, saveLocalArea } from '@/lib/news/settings/local-area';

/**
 * Give this account a new address.
 *
 * Nothing is read from the form: there is one address per account and the
 * session says whose it is. The old one stops working as the row changes,
 * which is the point of the control and is said on the page above it.
 *
 * The shape of what comes back is ConfirmStep's: it shows `error` in place
 * rather than throwing the page away.
 */
// latency: pending
export async function replaceAddress(): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const client = await createNewsClient();

  try {
    await loadOrCreateLocalPart(client, user.id);
    await replaceLocalPart(client, user.id);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Your address could not be replaced.',
    };
  }

  revalidatePath('/news/settings');
  return { ok: true };
}

/**
 * Bring a topic hidden with Fewer like this back into Quick read (plan #861).
 */
// latency: pending
export async function showHiddenTopic(formData: FormData): Promise<void> {
  const topic = readTopic(formData.get('topic'));
  if (!topic) return;

  const user = await requireUser();
  const client = await createNewsClient();
  await showTopic(client, { userId: user.id, topic });

  revalidatePath('/news/settings');
  revalidatePath('/news');
}

/**
 * Name, change or clear the place the Local topic is about (note 552a9407).
 * Only newsletters summarised from now on are tagged by it.
 */
// latency: pending
export async function setLocalArea(value: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const client = await createNewsClient();
  try {
    await saveLocalArea(client, { userId: user.id, area: readLocalArea(value) });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Your local area could not be saved.' };
  }
  revalidatePath('/news/settings');
  return {};
}

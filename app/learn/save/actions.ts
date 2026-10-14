'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { fetchLinkMeta, saveLink } from '@/lib/learn/tracks/link';
import { findLink } from '@/lib/learn/tracks/link-meta';

/**
 * Saving a link to read later in one step: the box on Reading lists and the
 * page a phone's share sheet opens (/learn/save) both call this. The page's
 * title and author are read from the page, so nothing has to be typed.
 */

export type SaveLinkState =
  | { status: 'idle' }
  | { status: 'error'; error: string }
  | { status: 'saved'; readingId: string; title: string; created: boolean };

// latency: pending
export async function saveReadingLink(_prev: SaveLinkState, formData: FormData): Promise<SaveLinkState> {
  const raw = (name: string) => {
    const value = formData.get(name);
    return typeof value === 'string' ? value.slice(0, 4000) : null;
  };
  const url = findLink(raw('url'), raw('text'));
  if (!url) return { status: 'error', error: 'Paste a link that starts with http:// or https://.' };

  const user = await requireUser();
  const meta = await fetchLinkMeta(url);
  try {
    const saved = await saveLink(await createLearnClient(), user.id, { url, meta });
    revalidatePath('/learn', 'layout');
    return { status: 'saved', readingId: saved.readingId, title: saved.title, created: saved.created };
  } catch {
    return { status: 'error', error: 'That link did not save. Try again.' };
  }
}

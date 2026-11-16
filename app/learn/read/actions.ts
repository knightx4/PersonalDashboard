'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { fireReaderRoutine, requestSource } from '@/lib/learn/reader/request';
import { giveText, loadSource, setSectionRead, setVerdict } from '@/lib/learn/reader/store';

/**
 * What the reader can do. Reading and marking call no model. Asking for
 * something queues it for the routine (lib/learn/reader/request.ts).
 */

export type AskState = { error?: string };

/** Mark a section read and go on to the next, or back to the outline after the last. */
// latency: pending
export async function finishSection(sourceId: string, section: number): Promise<void> {
  const user = await requireUser();
  const supabase = await createLearnClient();
  await setSectionRead(supabase, user.id, sourceId, section, true);
  const source = await loadSource(supabase, user.id, sourceId);
  const total = source?.prepared?.sections.length ?? 0;
  revalidatePath('/learn/read');
  redirect(section < total ? `/learn/read/${sourceId}/${section + 1}` : `/learn/read/${sourceId}`);
}

/** Take back a section marked read. */
// latency: pending
export async function unreadSection(sourceId: string, section: number): Promise<void> {
  const user = await requireUser();
  await setSectionRead(await createLearnClient(), user.id, sourceId, section, false);
  revalidatePath(`/learn/read/${sourceId}`);
}

/** Keep a source, or say it is not for you, which takes it off the shelves. */
// latency: pending
export async function judgeSource(sourceId: string, verdict: 'kept' | 'dropped'): Promise<void> {
  const user = await requireUser();
  await setVerdict(await createLearnClient(), user.id, sourceId, verdict);
  revalidatePath('/learn/read');
  if (verdict === 'dropped') redirect('/learn/read');
}

/** A topic, a link or a pasted text: queue it to be found and prepared. */
// latency: pending
export async function askFor(_prev: AskState, formData: FormData): Promise<AskState> {
  const user = await requireUser();
  const what = String(formData.get('what') ?? '').trim();
  if (!what) return { error: 'Type a topic, paste a link, or paste the text itself.' };
  if (what.length > 500000)
    return { error: 'That text is too long to take in one piece. Paste a chapter at a time.' };
  // Long enough to be the thing itself rather than a name for it.
  const pasted = what.length > 1500;
  const supabase = await createLearnClient();
  const request = await requestSource(supabase, user.id, {
    title: pasted ? `${what.slice(0, 60).replace(/\s+/g, ' ')}…` : what.slice(0, 300),
    origin: 'asked',
    asked: pasted ? 'A text you pasted.' : what,
    givenText: pasted ? what : null,
  });
  revalidatePath('/learn/read');
  redirect(`/learn/read/${request.id}`);
}

/** More on one section: what the person wants more of, queued as a source of its own. */
// latency: pending
export async function goDeeper(
  sourceId: string,
  section: number,
  formData: FormData,
): Promise<void> {
  const user = await requireUser();
  const ask = String(formData.get('ask') ?? formData.get('own') ?? '').trim();
  if (!ask) return;
  const supabase = await createLearnClient();
  const source = await loadSource(supabase, user.id, sourceId);
  const part = source?.prepared?.sections[section - 1];
  if (!source || !part) throw new Error('That section is not here.');
  const request = await requestSource(supabase, user.id, {
    title: `${ask.slice(0, 120)} (from ${source.title})`,
    origin: 'deeper',
    asked: ask.slice(0, 2000),
    why: `You asked for this while reading ${source.title}, "${part.title}".`,
    parentId: sourceId,
    parentSection: section,
  });
  revalidatePath('/learn/read');
  redirect(`/learn/read/${request.id}`);
}

/** The person's own copy of a work whose text could not be shown. */
// latency: pending
export async function addYourCopy(
  sourceId: string,
  _prev: AskState,
  formData: FormData,
): Promise<AskState> {
  const user = await requireUser();
  const copy = String(formData.get('copy') ?? '').trim();
  if (copy.length < 500) return { error: 'Paste the text of the chapter or paper itself.' };
  if (copy.length > 500000)
    return { error: 'That is too long to take in one piece. Paste a chapter at a time.' };
  const supabase = await createLearnClient();
  await giveText(supabase, user.id, sourceId, copy);
  await fireReaderRoutine(supabase, user.id);
  revalidatePath(`/learn/read/${sourceId}`);
  return {};
}

/** Ask Dash to find more to read: a few near the person's notes, a few from new ground. */
// latency: pending
export async function findMore(): Promise<void> {
  const user = await requireUser();
  await requestSource(await createLearnClient(), user.id, {
    title: 'More to read',
    origin: 'refill',
  });
  revalidatePath('/learn/read');
}

/** Start the routine on a source that has been waiting, or try one that stopped. */
// latency: pending
export async function startPreparing(sourceId: string): Promise<void> {
  const user = await requireUser();
  const supabase = await createLearnClient();
  const now = new Date().toISOString();
  await supabase
    .from('reader_sources')
    .update({ status: 'queued', error: null, updated_at: now })
    .eq('id', sourceId)
    .eq('user_id', user.id)
    .eq('status', 'failed');
  await fireReaderRoutine(supabase, user.id);
  revalidatePath(`/learn/read/${sourceId}`);
}

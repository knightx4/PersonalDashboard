'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { linkMessage } from '@/app/jobs/(app)/review/actions';
import { findUnlinkedMessages, type UnlinkedMessage } from '@/lib/jobs/inbox/link-candidates';
import { declineMessageForApplication, unlinkMessageFromApplication } from '@/lib/jobs/inbox/role-mail';

const unlinkSchema = z.object({
  messageId: z.string().uuid(),
  applicationId: z.string().uuid(),
});

/**
 * "This email is not about this pursuit."
 *
 * The message goes back to the review queue rather than being thrown away, and
 * every event it wrote here goes with it — leaving those behind would keep the
 * status derived from mail this role no longer claims. The pair is remembered
 * as declined so the same suggestion does not immediately offer itself again.
 */
// latency: pending
export async function unlinkMessage(
  messageId: string,
  applicationId: string,
): Promise<{ error: string | null }> {
  const parsed = unlinkSchema.safeParse({ messageId, applicationId });
  if (!parsed.success) return { error: 'That is not an unlinkable pair.' };

  const user = await requireUser();
  const supabase = await createClient();

  const { data: message } = await supabase
    .from('inbox_messages')
    .select('id, user_id')
    .eq('id', parsed.data.messageId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!message) return { error: 'That message is no longer in the mailbox.' };

  // Events first, then the email back to the queue, then the pair declined
  // (lib/jobs/inbox/role-mail.ts). A decline that did not stick only lets the
  // suggestion offer itself again, so it is not an error here.
  const { unlinked, error } = await unlinkMessageFromApplication(supabase, user.id, parsed.data.applicationId, parsed.data.messageId);
  if (!unlinked) return { error };

  revalidatePath('/jobs/roles/[id]', 'page');
  revalidatePath('/jobs/review');
  revalidatePath('/jobs/pipeline');
  return { error: null };
}

/** Approve a suggested match, or one found through "add other": the same manual link the review queue writes. */
// latency: pending
export async function linkCandidateMessage(
  messageId: string,
  applicationId: string,
): Promise<{ error: string | null }> {
  const result = await linkMessage(messageId, applicationId);
  if (!result.error) revalidatePath('/jobs/roles/[id]', 'page');
  return result;
}

const declineSchema = z.object({
  messageId: z.string().uuid(),
  applicationId: z.string().uuid(),
});

/**
 * "Not this one." Remembered per pursuit so the same suggestion does not keep
 * coming back — the message itself is untouched and can still be linked
 * elsewhere, or found again through "add other" if this was a mistake.
 */
// latency: pending
export async function declineCandidateMessage(
  messageId: string,
  applicationId: string,
): Promise<{ error: string | null }> {
  const parsed = declineSchema.safeParse({ messageId, applicationId });
  if (!parsed.success) return { error: 'That is not a declinable pair.' };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await declineMessageForApplication(supabase, user.id, parsed.data.applicationId, parsed.data.messageId);

  if (error) return { error };
  revalidatePath('/jobs/roles/[id]', 'page');
  return { error: null };
}

/** The "add other" search: any unlinked mail naming the search term, not just the company. */
// latency: pending
export async function searchUnlinkedMessages(
  applicationId: string,
  term: string,
): Promise<{ results: UnlinkedMessage[]; error: string | null }> {
  const parsed = z.object({ applicationId: z.string().uuid(), term: z.string() }).safeParse({
    applicationId,
    term,
  });
  if (!parsed.success) return { results: [], error: 'That is not a valid search.' };

  const user = await requireUser();
  const supabase = await createClient();

  const results = await findUnlinkedMessages(supabase, user.id, {
    applicationId: parsed.data.applicationId,
    term: parsed.data.term,
  });
  return { results, error: null };
}

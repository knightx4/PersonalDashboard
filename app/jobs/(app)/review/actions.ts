'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { eventKindFor, type MessageClassification } from '@/lib/jobs/email/classify';
import { unappliedEventNeedsReview } from '@/lib/jobs/review/flagging';
import { isTerminal, type ApplicationStatus } from '@/lib/jobs/pipeline';

/**
 * Working the queue.
 *
 * Every action here is one click plus a keyboard shortcut, because how fast a
 * linking decision can be made determines whether the pipeline stays current —
 * and a pipeline nobody maintains is one nobody trusts.
 */

const linkSchema = z.object({
  messageId: z.string().uuid(),
  applicationId: z.string().uuid(),
});

export async function linkMessage(
  messageId: string,
  applicationId: string,
): Promise<{ error: string | null }> {
  const parsed = linkSchema.safeParse({ messageId, applicationId });
  if (!parsed.success) return { error: 'That is not a linkable pair.' };

  const user = await requireUser();
  const supabase = await createClient();

  // Through the view, filtered on user_id: PostgREST cannot embed
  // core.email_accounts from this schema, and the view carries the owner
  // already so the check is a column comparison rather than a join.
  const { data: message } = await supabase
    .from('inbox_messages')
    .select('id, classification, received_at, subject, user_id')
    .eq('id', parsed.data.messageId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!message) return { error: 'That message is no longer in the queue.' };

  const { data: application } = await supabase
    .from('applications')
    .select('id, status')
    .eq('id', parsed.data.applicationId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!application) return { error: 'That application no longer exists.' };

  const kind = eventKindFor(message.classification as MessageClassification);

  const { error } = await supabase
    .from('ingested_messages')
    .update({
      resulting_application_id: parsed.data.applicationId,
      parse_status: 'parsed',
      link_method: 'manual',
      link_confidence: 1,
      error: null,
    })
    .eq('id', parsed.data.messageId);

  if (error) return { error: error.message };

  if (kind) {
    // The same backwards-transition rule applies to a hand link: the event is
    // recorded, and it does not reopen a closed pursuit.
    //
    // Whether that is worth telling you about is a separate question, and the
    // answer is the ingestion's -- unappliedEventNeedsReview. Flagging every
    // such event meant filing a message by hand put a fresh row back in the
    // queue you were clearing, including for the echoes (a second rejection, a
    // confirmation arriving after the close) that ask nobody anything.
    const wouldReopen =
      isTerminal(application.status as ApplicationStatus) && unappliedEventNeedsReview(kind);
    await supabase.from('application_events').insert({
      user_id: user.id,
      application_id: parsed.data.applicationId,
      kind,
      occurred_at: (message.received_at as string) ?? new Date().toISOString(),
      source: 'email',
      ingested_message_id: parsed.data.messageId,
      summary: (message.subject as string) ?? 'Linked by hand from the review queue',
      needs_review: wouldReopen,
    });
  }

  revalidatePath('/jobs/review');
  revalidatePath('/jobs/pipeline');
  return { error: null };
}

/**
 * Dismiss a message. The subject and sender are cleared at the same time,
 * because a message that turns out to be irrelevant must not keep its
 * retention exemption — the database constraint enforces the same rule.
 */
export async function dismissMessage(messageId: string): Promise<{ error: string | null }> {
  await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('ingested_messages')
    .update({
      classification: 'not_relevant',
      parse_status: 'skipped',
      subject: null,
      from_address: null,
      reply_to_address: null,
      thread_id: null,
      resulting_application_id: null,
      link_method: null,
      link_confidence: null,
      error: null,
    })
    .eq('id', messageId);

  if (error) return { error: error.message };
  revalidatePath('/jobs/review');
  return { error: null };
}

export async function confirmApplication(
  applicationId: string,
): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('applications')
    .update({ needs_review: false })
    .eq('id', applicationId)
    .eq('user_id', user.id);

  if (error) return { error: error.message };
  revalidatePath('/jobs/review');
  revalidatePath('/jobs/pipeline');
  return { error: null };
}

export async function deleteInferredApplication(
  applicationId: string,
): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();

  // Only ever an inferred row: a hand-created application is never deleted
  // from the review queue by accident.
  const { data: application } = await supabase
    .from('applications')
    .select('id, role_id, created_by')
    .eq('id', applicationId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!application) return { error: 'That application no longer exists.' };
  if (application.created_by !== 'email_inferred') {
    return { error: 'Only applications the inbox created can be removed from here.' };
  }

  const { error } = await supabase
    .from('applications')
    .delete()
    .eq('id', applicationId)
    .eq('user_id', user.id);

  if (error) return { error: error.message };

  // The role was created alongside it and has nothing else attached.
  const { count } = await supabase
    .from('applications')
    .select('id', { count: 'exact', head: true })
    .eq('role_id', application.role_id);
  if ((count ?? 0) === 0) {
    await supabase.from('roles').delete().eq('id', application.role_id).eq('user_id', user.id);
  }

  revalidatePath('/jobs/review');
  revalidatePath('/jobs/pipeline');
  return { error: null };
}

/** Acknowledge a conflicting event. It stays on the timeline; the flag clears. */
export async function acknowledgeEvent(eventId: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('application_events')
    .update({ needs_review: false })
    .eq('id', eventId)
    .eq('user_id', user.id);

  if (error) return { error: error.message };
  revalidatePath('/jobs/review');
  return { error: null };
}

/**
 * Reopen a closed pursuit, deliberately and by hand.
 *
 * A stray email never does this on its own. When a recruiter genuinely does
 * come back after a rejection, this is the explicit action that says so.
 */
export async function reopenApplication(
  applicationId: string,
  status: 'in_process' | 'final_round',
): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();

  await supabase.from('application_events').insert({
    user_id: user.id,
    application_id: applicationId,
    kind: 'status_override',
    occurred_at: new Date().toISOString(),
    source: 'manual',
    summary: `Reopened by hand as ${status.replace(/_/g, ' ')}`,
    payload: { status },
  });

  const { error } = await supabase
    .from('applications')
    .update({ status_manual_override: status })
    .eq('id', applicationId)
    .eq('user_id', user.id);

  if (error) return { error: error.message };
  revalidatePath('/jobs/review');
  revalidatePath('/jobs/pipeline');
  return { error: null };
}

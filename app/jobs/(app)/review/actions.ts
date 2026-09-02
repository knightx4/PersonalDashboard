'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { ensureCompany } from '@/lib/jobs/companies/ensure';
import { eventKindFor, type MessageClassification } from '@/lib/jobs/email/classify';
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
    const wouldReopen = isTerminal(application.status as ApplicationStatus);
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

const newRoleSchema = z.object({
  messageId: z.string().uuid(),
  companyName: z.string().trim().min(1, 'Which company is this?').max(200),
  title: z.string().trim().min(1, 'What is the role called?').max(200),
});

/**
 * The fourth option: none of these, it is a new pursuit.
 *
 * The queue offered three existing applications and "not relevant", which
 * leaves the common case unhandled — mail about something real that has
 * nothing on file yet. Dismissing it loses the evidence, and creating the role
 * on another page and coming back to link it by hand is four screens for one
 * decision.
 *
 * The pursuit is created with no submitted date: linking the message writes
 * the event its classification implies, and status is derived from events, so
 * a rejection lands as rejected and an interview invite as in process without
 * this having to guess.
 */
export async function createRoleFromMessage(input: {
  messageId: string;
  companyName: string;
  title: string;
}): Promise<{ error: string | null; roleId: string | null }> {
  const parsed = newRoleSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message, roleId: null };

  const user = await requireUser();
  const supabase = await createClient();

  const { data: message } = await supabase
    .from('inbox_messages')
    .select('id, user_id')
    .eq('id', parsed.data.messageId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!message) return { error: 'That message is no longer in the queue.', roleId: null };

  const company = await ensureCompany(supabase, user.id, parsed.data.companyName);
  if (company.error) return { error: company.error, roleId: null };

  const { data: role, error: roleError } = await supabase
    .from('roles')
    .insert({
      user_id: user.id,
      company_id: company.id,
      title: parsed.data.title,
      source: 'recruiter_inbound',
    })
    .select('id')
    .single();

  if (roleError || !role) {
    return { error: roleError?.message ?? 'Could not create the role.', roleId: null };
  }

  const { data: application, error: applicationError } = await supabase
    .from('applications')
    .insert({
      user_id: user.id,
      role_id: role.id,
      source: 'recruiter_inbound',
      // A person read the message and said this is a real pursuit, which is
      // exactly what the inferred flag exists to ask about.
      created_by: 'manual',
    })
    .select('id')
    .single();

  if (applicationError || !application) {
    // The role would otherwise sit there with nothing attached to it.
    await supabase.from('roles').delete().eq('id', role.id).eq('user_id', user.id);
    return {
      error: applicationError?.message ?? 'Could not create the pursuit.',
      roleId: null,
    };
  }

  const linked = await linkMessage(parsed.data.messageId, application.id as string);
  if (linked.error) return { error: linked.error, roleId: role.id as string };

  revalidatePath('/jobs/review');
  revalidatePath('/jobs/roles');
  revalidatePath('/jobs/pipeline');
  return { error: null, roleId: role.id as string };
}

/**
 * Dismiss a message. This row is only this workspace's verdict: the envelope —
 * subject, sender, reply-to, thread — lives in `core.ingested_messages` and is
 * not ours to clear, because a message the job side finds irrelevant may be an
 * order confirmation the commerce side is keeping. Scrubbing happens once in
 * core, by the sweep at the end of a sync, when every workspace has disclaimed
 * it. Writing the envelope columns here is what produced the "from_address not
 * in the schema cache" error: they stopped existing on this table at the
 * ingestion unification.
 */
export async function dismissMessage(messageId: string): Promise<{ error: string | null }> {
  await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('ingested_messages')
    .update({
      classification: 'not_relevant',
      parse_status: 'skipped',
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

/**
 * Acknowledge a conflicting event. It stays on the timeline; the flag clears.
 *
 * `acknowledged_at` is what makes that stick. Clearing the flag is an update to
 * application_events, which fires the sync trigger, which re-derives
 * needs_review for every event sitting on a closed pursuit — so without a
 * record that a person answered it, the flag came straight back and the button
 * did nothing at all.
 */
export async function acknowledgeEvent(eventId: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('application_events')
    .update({ needs_review: false, acknowledged_at: new Date().toISOString() })
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

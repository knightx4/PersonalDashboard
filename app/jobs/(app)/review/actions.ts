'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { connectedAccountIds } from '@/lib/core/inbox/accounts';
import { ensureCompany } from '@/lib/jobs/companies/ensure';
import { eventKindFor, type MessageClassification } from '@/lib/jobs/email/classify';
import { excludableDomains } from '@/lib/jobs/review/exclusions';
import { handLinkedEventNeedsReview } from '@/lib/jobs/review/flagging';
import { type ApplicationStatus } from '@/lib/jobs/pipeline';

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

// latency: pending
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
    // recorded, and it does not reopen a closed pursuit. Whether the conflict
    // is worth raising is the ingestion's rule too -- a rejection landing on a
    // pursuit that is already closed is an echo, not a reason to ask whether
    // it reopened.
    const conflict = handLinkedEventNeedsReview(application.status as ApplicationStatus, kind);
    await supabase.from('application_events').insert({
      user_id: user.id,
      application_id: parsed.data.applicationId,
      kind,
      occurred_at: (message.received_at as string) ?? new Date().toISOString(),
      source: 'email',
      ingested_message_id: parsed.data.messageId,
      summary: (message.subject as string) ?? 'Linked by hand from the review queue',
      needs_review: conflict,
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
// latency: pending
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
// latency: pending
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

// latency: pending
export async function confirmApplication(applicationId: string): Promise<{ error: string | null }> {
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

// latency: pending
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
 * Not relevant, and nothing from this employer ever again.
 *
 * The one-off verdict was always available; what was missing was the standing
 * one. An agency or a job board that spawned one inferred pursuit will spawn
 * another next sync, and answering the same row every week is how a review
 * queue stops being worked.
 *
 * Only the employer's own domains are written. greenhouse.io is on the record
 * of every Greenhouse customer, and excluding it to be rid of one company
 * would silently drop every other company's mail with it -- see
 * lib/jobs/review/exclusions.ts, which is also what decides whether this
 * button is offered at all.
 */
// latency: pending
export async function excludeCompanyForApplication(
  applicationId: string,
): Promise<{ error: string | null; message?: string }> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: application } = await supabase
    .from('applications')
    .select('id, created_by, roles!inner ( companies!inner ( name, domains ) )')
    .eq('id', applicationId)
    .eq('user_id', user.id)
    .maybeSingle<{
      id: string;
      created_by: string;
      roles: { companies: { name: string; domains: string[] | null } };
    }>();

  if (!application) return { error: 'That application no longer exists.' };

  const company = application.roles.companies;
  const domains = excludableDomains(company.domains);
  if (domains.length === 0) {
    return {
      error: `No sending domain of ${company.name}'s own is on file, so there is nothing to exclude. Add one under Settings → Excluded senders.`,
    };
  }

  // Already-excluded domains are not an error: the point of the button is the
  // outcome, and a second click should read as "yes, still excluded". Filtered
  // rather than upserted, because the uniqueness is an expression index on
  // (user_id, lower(domain)) and ON CONFLICT cannot name it.
  const { data: already } = await supabase
    .from('excluded_senders')
    .select('domain')
    .eq('user_id', user.id);

  const have = new Set(
    ((already ?? []) as Array<{ domain: string }>).map((row) => row.domain.toLowerCase()),
  );
  const missing = domains.filter((domain) => !have.has(domain));

  if (missing.length > 0) {
    const { error } = await supabase
      .from('excluded_senders')
      .insert(missing.map((domain) => ({ user_id: user.id, domain })));
    if (error) return { error: error.message };
  }

  // The pursuit in front of you goes too, where it is one the inbox invented.
  // A hand-created application is a decision you made and is never removed by
  // a button about senders.
  if (application.created_by === 'email_inferred') {
    const removed = await deleteInferredApplication(applicationId);
    if (removed.error) return { error: removed.error };
  }

  revalidatePath('/jobs/review');
  revalidatePath('/jobs/settings');
  return {
    error: null,
    message: `Removed, and mail from ${domains.join(', ')} will no longer open a pursuit.`,
  };
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
// latency: pending
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
// latency: pending
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

/**
 * The bulk half: one call for a whole selection, and the way back from it.
 *
 * Same contract as the shopping queue's bulk actions. `changed` is the rows the
 * call actually moved rather than the rows it was asked about, so the toast
 * counts what happened; `restore` carries what cannot be worked out afterwards,
 * which for a dismissed message is everything the dismissal cleared.
 */
export type JobsBulkResult = {
  changed: string[];
  error?: string | null;
};

/** A message as it was before it was dismissed. */
const dismissedMessage = z.object({
  id: z.string().uuid(),
  classification: z.string().max(60).nullable(),
  parseStatus: z.enum(['parsed', 'needs_review', 'skipped', 'failed']),
  applicationId: z.string().uuid().nullable(),
  linkMethod: z.string().max(40).nullable(),
  linkConfidence: z.number().nullable(),
  error: z.string().nullable(),
});

export type DismissedMessage = z.infer<typeof dismissedMessage>;

const jobsIdList = z.array(z.string().uuid()).min(1).max(200);

const INVALID_SELECTION = 'That selection is not something we can act on.';

/** Dismiss every selected message that is still waiting. */
// latency: pending
export async function dismissMessages(
  ids: string[],
): Promise<JobsBulkResult & { restore: DismissedMessage[] }> {
  const parsed = jobsIdList.safeParse(ids);
  if (!parsed.success) return { changed: [], restore: [], error: INVALID_SELECTION };

  const user = await requireUser();
  const supabase = await createClient();
  const core = await createCoreClient();
  const accountIds = await connectedAccountIds(core, user.id);
  if (accountIds.length === 0) return { changed: [], restore: [], error: 'No inbox connected.' };

  const { data: messages, error: loadError } = await supabase
    .from('inbox_messages')
    .select(
      'id, classification, parse_status, resulting_application_id, link_method, link_confidence, error',
    )
    .in('id', parsed.data)
    .in('email_account_id', accountIds)
    .eq('parse_status', 'needs_review');

  if (loadError) return { changed: [], restore: [], error: loadError.message };

  const restore: DismissedMessage[] = (messages ?? []).map((row) => ({
    id: row.id as string,
    classification: (row.classification as string | null) ?? null,
    parseStatus: 'needs_review' as const,
    applicationId: (row.resulting_application_id as string | null) ?? null,
    linkMethod: (row.link_method as string | null) ?? null,
    linkConfidence: (row.link_confidence as number | null) ?? null,
    error: (row.error as string | null) ?? null,
  }));
  if (restore.length === 0) {
    return { changed: [], restore: [], error: 'Those are dismissed already.' };
  }

  const changed = restore.map((row) => row.id);
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
    .in('id', changed)
    .in('email_account_id', accountIds);

  if (error) return { changed: [], restore: [], error: error.message };

  revalidatePath('/jobs/review');
  return { changed, restore };
}

/** The way back from a bulk dismiss: every column the dismissal cleared. */
// latency: pending
export async function restoreDismissedMessages(
  restore: DismissedMessage[],
): Promise<JobsBulkResult> {
  const parsed = z.array(dismissedMessage).min(1).max(200).safeParse(restore);
  if (!parsed.success) return { changed: [], error: INVALID_SELECTION };

  const user = await requireUser();
  const supabase = await createClient();
  const core = await createCoreClient();
  const accountIds = await connectedAccountIds(core, user.id);
  if (accountIds.length === 0) return { changed: [], error: 'No inbox connected.' };

  // One statement per message: each goes back to its own classification and its
  // own link. A selection is tens of rows, not thousands.
  for (const message of parsed.data) {
    const { error } = await supabase
      .from('ingested_messages')
      .update({
        classification: message.classification,
        parse_status: message.parseStatus,
        resulting_application_id: message.applicationId,
        link_method: message.linkMethod,
        link_confidence: message.linkConfidence,
        error: message.error,
      })
      .eq('id', message.id)
      .in('email_account_id', accountIds);

    if (error) return { changed: [], error: error.message };
  }

  revalidatePath('/jobs/review');
  return { changed: parsed.data.map((row) => row.id) };
}

/** Acknowledge every selected event. They stay on the timeline; the flag goes. */
// latency: pending
export async function acknowledgeEvents(ids: string[]): Promise<JobsBulkResult> {
  const parsed = jobsIdList.safeParse(ids);
  if (!parsed.success) return { changed: [], error: INVALID_SELECTION };

  const user = await requireUser();
  const supabase = await createClient();

  const { data: events, error: loadError } = await supabase
    .from('application_events')
    .select('id')
    .in('id', parsed.data)
    .eq('user_id', user.id)
    .eq('needs_review', true);

  if (loadError) return { changed: [], error: loadError.message };

  const changed = (events ?? []).map((row) => row.id as string);
  if (changed.length === 0) return { changed: [], error: 'Those are acknowledged already.' };

  const { error } = await supabase
    .from('application_events')
    .update({ needs_review: false, acknowledged_at: new Date().toISOString() })
    .in('id', changed)
    .eq('user_id', user.id);

  if (error) return { changed: [], error: error.message };

  revalidatePath('/jobs/review');
  return { changed };
}

/**
 * The way back from a bulk acknowledge.
 *
 * Clearing `acknowledged_at` as well as the flag, because the flag on its own
 * comes straight back off the sync trigger — the same reason acknowledging
 * writes it in the first place.
 */
// latency: pending
export async function unacknowledgeEvents(ids: readonly string[]): Promise<JobsBulkResult> {
  const parsed = jobsIdList.safeParse([...ids]);
  if (!parsed.success) return { changed: [], error: INVALID_SELECTION };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('application_events')
    .update({ needs_review: true, acknowledged_at: null })
    .in('id', parsed.data)
    .eq('user_id', user.id);

  if (error) return { changed: [], error: error.message };

  revalidatePath('/jobs/review');
  return { changed: [...parsed.data] };
}

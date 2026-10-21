import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { eventKindFor, type MessageClassification } from '@/lib/jobs/email/classify';
import { ensureInterviewRound } from '@/lib/jobs/interview/ensure-round';
import type { ApplicationStatus } from '@/lib/jobs/pipeline';
import { handLinkedEventNeedsReview } from '@/lib/jobs/review/flagging';

/**
 * An email and a pursuit, put together or kept apart by hand: the review
 * queue's link, the role page's mail tab (link a suggestion, turn one down,
 * unlink one), and Dash's change_role_email and add_role_from_email (plan
 * #2473.2). Each says what it wrote, so Dash can keep it for its Undo.
 *
 * The verdict rows (job_search.ingested_messages) have no user_id. The caller
 * has read the email through job_search.inbox_messages by the person's id.
 */

type Row = Record<string, unknown>;

/** What a hand link writes onto the email. */
export const LINKED_BY_HAND = { parse_status: 'parsed', link_method: 'manual', link_confidence: 1, error: null } as const;

/** What an unlink writes: the email goes back to the review queue, saying why. */
export const UNLINKED_BY_HAND = {
  resulting_application_id: null,
  parse_status: 'needs_review',
  link_method: null,
  link_confidence: null,
  error: 'Unlinked by hand from the role page.',
} as const;

export type MessageLinked = {
  /** Whether the email now points at the application. */
  linked: boolean;
  /** The event the email's classification filed on the timeline, if any. */
  eventId: string | null;
  /** The round an interview invite booked, when it booked one. */
  round: { interviewId: string; groupId: string; groupCreated: boolean } | null;
  error: string | null;
};

/**
 * Link an email to an application: the email is marked linked by hand, and
 * the event its classification implies is filed on the timeline. The same
 * backwards-transition rule as the ingestion holds: the event is recorded and
 * does not reopen a closed pursuit, and whether it is raised for review is the
 * ingestion's rule too. An interview invite gets its round, with the date to
 * be set; ensureInterviewRound books nothing where an interview is on file.
 */
export async function linkMessageToApplication(
  supabase: AppSupabaseClient,
  userId: string,
  message: { id: string; classification: unknown; received_at: unknown; subject: unknown },
  application: { id: string; status: unknown },
): Promise<MessageLinked> {
  const { error } = await supabase
    .from('ingested_messages')
    .update({ resulting_application_id: application.id, ...LINKED_BY_HAND })
    .eq('id', message.id);
  if (error) return { linked: false, eventId: null, round: null, error: error.message };

  const kind = eventKindFor(message.classification as MessageClassification);
  if (!kind) return { linked: true, eventId: null, round: null, error: null };

  const { data: event, error: eventError } = await supabase
    .from('application_events')
    .insert({
      user_id: userId,
      application_id: application.id,
      kind,
      occurred_at: typeof message.received_at === 'string' ? message.received_at : new Date().toISOString(),
      source: 'email',
      ingested_message_id: message.id,
      summary: typeof message.subject === 'string' && message.subject ? message.subject : 'Linked by hand',
      needs_review: handLinkedEventNeedsReview(application.status as ApplicationStatus, kind),
    })
    .select('id')
    .maybeSingle();
  if (eventError || !event) {
    return { linked: true, eventId: null, round: null, error: `Filing the email on the timeline failed: ${eventError?.message ?? 'no row'}` };
  }
  const eventId = (event as Row).id as string;
  if (kind !== 'interview_scheduled') return { linked: true, eventId, round: null, error: null };

  const round = await ensureInterviewRound(supabase, { userId, applicationId: application.id, kind: null });
  return { linked: true, eventId, round: round ?? null, error: null };
}

/**
 * A new pursuit for mail about something real with nothing on file: the role
 * and its application, with the channel the email implies. Made by hand, so
 * not an inferred one. No submitted date: linking the email files the event
 * its classification implies, and the status follows from events. When the
 * application cannot be made the role goes too, so it does not sit there with
 * nothing on it.
 */
export async function addPursuitFromMail(
  supabase: AppSupabaseClient,
  userId: string,
  pursuit: { companyId: string; title: string; channel: string },
): Promise<{ role: Row | null; applicationId: string | null; error: string | null }> {
  const { data: role, error: roleError } = await supabase
    .from('roles')
    .insert({ user_id: userId, company_id: pursuit.companyId, title: pursuit.title, source: pursuit.channel })
    .select('*')
    .maybeSingle();
  if (roleError || !role) return { role: null, applicationId: null, error: roleError?.message ?? 'Could not create the role.' };
  const roleId = (role as Row).id as string;

  const { data: application, error: applicationError } = await supabase
    .from('applications')
    .insert({ user_id: userId, role_id: roleId, source: pursuit.channel, created_by: 'manual' })
    .select('id')
    .maybeSingle();
  if (applicationError || !application) {
    await supabase.from('roles').delete().eq('id', roleId).eq('user_id', userId);
    return { role: null, applicationId: null, error: applicationError?.message ?? 'Could not create the pursuit.' };
  }
  return { role: role as Row, applicationId: (application as Row).id as string, error: null };
}

/**
 * "Not this one": remembered for the pair, so the same suggestion does not
 * keep coming back. The email itself is untouched.
 */
export async function declineMessageForApplication(
  supabase: AppSupabaseClient,
  userId: string,
  applicationId: string,
  messageId: string,
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from('message_link_dismissals')
    .upsert({ user_id: userId, application_id: applicationId, message_id: messageId }, { onConflict: 'application_id,message_id' })
    .select('id')
    .maybeSingle();
  if (error) return { id: null, error: error.message };
  return { id: ((data as Row | null)?.id as string | undefined) ?? null, error: null };
}

export type MessageUnlinked = {
  /** The events the email had filed on the application, taken out whole. */
  eventsRemoved: Row[];
  /** Whether the email went back to the queue. */
  unlinked: boolean;
  /** The "not this one" mark for the pair. */
  dismissalId: string | null;
  error: string | null;
};

/**
 * "This email is not about this pursuit." Every event it filed here goes
 * first, while the email still points at the application, so a failure
 * leaves the link whole rather than a timeline that has lost its evidence.
 * Then the email goes back to the review queue, and the pair is remembered
 * as declined so the suggestion does not offer itself again at once.
 */
export async function unlinkMessageFromApplication(
  supabase: AppSupabaseClient,
  userId: string,
  applicationId: string,
  messageId: string,
): Promise<MessageUnlinked> {
  const { data: events, error: eventsError } = await supabase
    .from('application_events')
    .delete()
    .eq('ingested_message_id', messageId)
    .eq('application_id', applicationId)
    .eq('user_id', userId)
    .select('*');
  if (eventsError) return { eventsRemoved: [], unlinked: false, dismissalId: null, error: eventsError.message };
  const eventsRemoved = (events ?? []) as Row[];

  const { error } = await supabase.from('ingested_messages').update(UNLINKED_BY_HAND).eq('id', messageId);
  if (error) return { eventsRemoved, unlinked: false, dismissalId: null, error: error.message };

  const declined = await declineMessageForApplication(supabase, userId, applicationId, messageId);
  return { eventsRemoved, unlinked: true, dismissalId: declined.id, error: declined.error };
}

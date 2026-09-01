import 'server-only';

import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { MessageEnvelope } from '@/lib/core/inbox/envelopes';
import { mapPool } from '@/lib/async/map-pool';
import {
  ACTIONABLE,
  classifyMessage,
  eventKindFor,
  type ClassifyResult,
  type CompanyDomainHit,
  type MessageClassification,
} from '@/lib/jobs/email/classify';
import { PARSER_VERSION, verifyExtraction, type ExtractedMessage } from '@/lib/jobs/email/extract';
import type { AtsVendor } from '@/lib/jobs/email/ats-senders';
import { isBoardVendor } from '@/lib/jobs/ats/detect';
import {
  decideLink,
  type LinkCandidate,
  type LinkCompany,
  type LinkDecision,
} from '@/lib/jobs/email/link';
import { gmailProvider } from '@/lib/email/providers/gmail';
import { isTerminal, type ApplicationStatus } from '@/lib/jobs/pipeline';
import { slugify } from '@/lib/jobs/slug';
import { extractWithModel, reconcileClassification } from '@/lib/jobs/inbox/tier-b';
import {
  inboundMayMove,
  inferredApplicationNeedsReview,
  unappliedEventNeedsReview,
} from '@/lib/jobs/review/flagging';
import { contactFromSender, contactsFromInvite, type CandidateContact } from '@/lib/jobs/contacts/from-mail';
import { parseIcs, primaryEvent } from '@/lib/jobs/calendar/ics';
import { interviewFromInvite, inviteSupersedes, type InviteInterview } from '@/lib/jobs/calendar/invite';


/** Parallel Gmail metadata fetches — well under the per-user rate quota. */
/**
 * Full body + model extraction, in flight at once.
 *
 * Two was set when this pass shared its invocation with a per-page sweep of the
 * held queue and the whole thing had to fit in a minute. It made the first scan
 * read about a third of a message a second. Six is still well inside Gmail's
 * per-user quota (a body fetch is five units of two hundred and fifty a second)
 * and inside the model's, and it costs nothing extra: the same messages get the
 * same calls, just not one after another.
 */
const EXTRACT_CONCURRENCY = 6;

/**
 * What a role is called when the mail did not say.
 *
 * Exported so the dedupe below can recognise its own placeholders: a row with
 * this title is "we know there is something here" rather than a distinct
 * pursuit, and treating it as distinct is what produced two rows for one
 * conversation.
 */
export const PLACEHOLDER_ROLE_TITLE = 'Role from email';

export type OpenPursuit = { roleId: string; roleTitle: string; applicationId: string };

export type PursuitChoice =
  | { kind: 'create' }
  | { kind: 'adopt'; applicationId: string }
  | { kind: 'rename'; applicationId: string; roleId: string };

/**
 * Which pursuit at this company an inferred message belongs to.
 *
 * A title match is the easy case and was the only case, which is how one
 * company ended up with "Finance Manager" and "Role from email" open beside
 * each other, both from the same conversation. A title the model could not
 * read is not evidence of a second pursuit -- it is the absence of evidence
 * either way.
 *
 * The two placeholder cases both insist on exactly one candidate. Where a
 * company has several things open, which one an untitled message belongs to is
 * a guess, and silently attaching mail to the wrong role is worse than a
 * duplicate row you can see and merge.
 */
export function choosePursuit(open: readonly OpenPursuit[], title: string): PursuitChoice {
  const wanted = title.toLowerCase();
  const isPlaceholder = (pursuit: OpenPursuit) =>
    pursuit.roleTitle.toLowerCase() === PLACEHOLDER_ROLE_TITLE.toLowerCase();

  const sameTitle = open.find((pursuit) => pursuit.roleTitle.toLowerCase() === wanted);
  if (sameTitle) return { kind: 'adopt', applicationId: sameTitle.applicationId };

  if (wanted === PLACEHOLDER_ROLE_TITLE.toLowerCase()) {
    return open.length === 1
      ? { kind: 'adopt', applicationId: open[0].applicationId }
      : { kind: 'create' };
  }

  const placeholders = open.filter(isPlaceholder);
  if (placeholders.length === 1) {
    return {
      kind: 'rename',
      applicationId: placeholders[0].applicationId,
      roleId: placeholders[0].roleId,
    };
  }

  return { kind: 'create' };
}

export type IngestCounters = {
  messagesSeen: number;
  messagesClassified: number;
  messagesParsed: number;
  applicationsCreated: number;
  leadsCreated: number;
  heldForReview: number;
  skipped: number;
  errors: number;
};

export function emptyCounters(): IngestCounters {
  return {
    messagesSeen: 0,
    messagesClassified: 0,
    messagesParsed: 0,
    applicationsCreated: 0,
    leadsCreated: 0,
    heldForReview: 0,
    skipped: 0,
    errors: 0,
  };
}

type FetchedMessage = Awaited<ReturnType<typeof gmailProvider.getMessage>>;

/**
 * Write the ledger row for a message.
 *
 * THE BODY IS NEVER STORED, and for `not_relevant` neither is the subject, the
 * sender, nor the thread id — that row exists solely so the next sync can skip
 * the message. The database constraint enforces this rather than trusting every
 * call site to remember, but the call sites remember anyway.
 */
async function writeLedger(
  supabase: AppSupabaseClient,
  opts: {
    coreId: string;
    /** For the log line only; the row is keyed by coreId. */
    providerMessageId: string;
    classification: MessageClassification;
    parseStatus: 'pending' | 'parsed' | 'failed' | 'skipped' | 'needs_review';
    applicationId?: string | null;
    linkConfidence?: number | null;
    linkMethod?: string | null;
    parseConfidence?: number | null;
    error?: string | null;
  },
): Promise<string | null> {
  // The envelope belongs to core; this row is only what the job workspace
  // concluded. Nulling the sender and subject on not_relevant used to happen
  // here -- it now happens in core, and only once every workspace has
  // disclaimed the message, because a message this side finds irrelevant may
  // be an order confirmation the other side is keeping.
  const row = {
    id: opts.coreId,
    classification: opts.classification,
    parse_status: opts.parseStatus,
    parser_version: PARSER_VERSION,
    resulting_application_id: opts.applicationId ?? null,
    link_confidence: opts.linkConfidence ?? null,
    link_method: opts.linkMethod ?? null,
    parse_confidence: opts.parseConfidence ?? null,
    error: opts.error ?? null,
  };

  const { error } = await supabase.from('ingested_messages').upsert(row);
  if (error) {
    console.error('verdict upsert failed', opts.providerMessageId, error.message);
    return null;
  }
  return opts.coreId;
}

/**
 * Whether the implied event may legally move this application forward.
 *
 * Returning false does not discard the event — the event is written and the
 * status is left alone, which is the rule that keeps a recruiter's post-
 * rejection follow-up from silently un-rejecting a pursuit.
 */
function transitionIsLegal(
  currentStatus: ApplicationStatus,
  kind: ReturnType<typeof eventKindFor>,
): boolean {
  if (kind === null) return true;
  // Nothing reopens a *decided* application from the inbox. A ghosting is not
  // a decision -- see inboundMayMove.
  return inboundMayMove(currentStatus);
}

async function currentStatus(
  supabase: AppSupabaseClient,
  applicationId: string,
): Promise<ApplicationStatus> {
  const { data } = await supabase
    .from('applications')
    .select('status')
    .eq('id', applicationId)
    .maybeSingle();
  return (data?.status as ApplicationStatus) ?? 'lead';
}

/**
 * The invite a message carries, if it carries one.
 *
 * Returns null rather than throwing for anything malformed: an invite we
 * cannot read costs us the invite, and the model's reading of the prose is
 * still there underneath it.
 */
function inviteFromMessage(
  message: FetchedMessage,
  ctx: Pick<IngestContext, 'accountEmail' | 'timezone'>,
): InviteInterview | null {
  if (!message.calendar?.length) return null;

  try {
    const events = message.calendar.flatMap((body) =>
      parseIcs(body, { defaultTimeZone: ctx.timezone }),
    );
    const event = primaryEvent(events);
    if (!event) return null;
    return interviewFromInvite(event, { selfEmail: ctx.accountEmail });
  } catch (error) {
    console.error('invite parse failed', message.id, {
      name: error instanceof Error ? error.name : 'unknown',
    });
    return null;
  }
}

async function writeEvent(
  supabase: AppSupabaseClient,
  opts: {
    userId: string;
    applicationId: string;
    ledgerId: string | null;
    classification: MessageClassification;
    extracted: ExtractedMessage | null;
    message: FetchedMessage;
    invite: InviteInterview | null;
    /** The connected mailbox: you are not one of your own contacts. */
    accountEmail: string | null;
  },
): Promise<void> {
  const kind = eventKindFor(opts.classification);
  if (!kind) return;

  const status = await currentStatus(supabase, opts.applicationId);
  const legal = transitionIsLegal(status, kind);

  const { invite } = opts;
  const interviewKind = invite?.kind ?? opts.extracted?.interviewKind ?? null;

  // Where an invite exists it is the schedule, full stop. The model's reading
  // of "Thursday at 2" is the fallback, not the other way round.
  const scheduledAt =
    invite?.scheduledAt ??
    opts.extracted?.dates?.find((d) => d.kind === 'interview')?.at ??
    opts.message.internalDate?.toISOString() ??
    new Date().toISOString();

  const interviewers = invite?.interviewerNames.length
    ? invite.interviewerNames
    : (opts.extracted?.interviewerNames ?? []);

  await supabase.from('application_events').insert({
    user_id: opts.userId,
    application_id: opts.applicationId,
    kind,
    // The event happened when the mail arrived. An interview date inside the
    // body is the *scheduled* time and belongs in the payload, not here --
    // using it as occurred_at would reorder the timeline into the future.
    occurred_at: opts.message.internalDate?.toISOString() ?? new Date().toISOString(),
    source: 'email',
    ingested_message_id: opts.ledgerId,
    summary: opts.extracted?.summary ?? defaultSummary(opts.classification),
    payload: {
      ...(interviewKind ? { interview_kind: interviewKind } : {}),
      ...(opts.extracted?.dates?.length ? { dates: opts.extracted.dates } : {}),
      ...(interviewers.length ? { interviewers } : {}),
      ...(opts.extracted?.actionRequired ? { action_required: true } : {}),
      ...(invite
        ? {
            // Recorded so the timeline can say "this was rescheduled" rather
            // than showing two bookings and letting you work it out.
            invite: {
              uid: invite.icsUid,
              sequence: invite.icsSequence,
              cancelled: invite.cancelled,
              ...(invite.meetingUrl ? { meeting_url: invite.meetingUrl } : {}),
              ...(invite.timeZone ? { time_zone: invite.timeZone } : {}),
            },
          }
        : {}),
      scheduled_at: scheduledAt,
    },
    // Flagged only when it is worth a look: forward-moving mail landing on a
    // pursuit the app believes is closed means the app is probably wrong. A
    // second rejection is an echo, and an echo is not a decision.
    needs_review: !legal && unappliedEventNeedsReview(kind),
  });

  // Whoever wrote it, if a person wrote it. Contacts and interview
  // participants were both empty after six months because both were things
  // you had to type, while every recruiter's mail carried a name and an
  // address in its From header the whole time.
  const sender = contactFromSender({
    classification: opts.classification,
    fromAddress: opts.message.fromAddress,
    replyToAddress: opts.message.replyToAddress,
    selfAddress: opts.accountEmail,
  });
  if (sender) {
    await upsertContact(supabase, {
      userId: opts.userId,
      companyId: await companyForApplication(supabase, opts.applicationId),
      contact: sender,
    });
  }

  if (!legal) return;

  if (invite) {
    // An invite is unambiguous evidence of a booking whatever the classifier
    // made of the covering note, so it is not gated on the event kind the way
    // a date read out of prose has to be.
    await applyInvite(supabase, {
      userId: opts.userId,
      applicationId: opts.applicationId,
      invite,
      fallbackKind: interviewKind,
    });
    return;
  }

  // No invite: the model's date, on the same terms as before.
  const interviewDate = opts.extracted?.dates?.find((d) => d.kind === 'interview');
  if (interviewDate && (kind === 'interview_scheduled' || kind === 'screen_scheduled')) {
    const { count } = await supabase
      .from('interviews')
      .select('id', { count: 'exact', head: true })
      .eq('application_id', opts.applicationId);
    await supabase.from('interviews').insert({
      user_id: opts.userId,
      application_id: opts.applicationId,
      round: (count ?? 0) + 1,
      kind: interviewKind ?? 'recruiter_screen',
      scheduled_at: interviewDate.at,
      format: 'video',
      status: 'scheduled',
    });
  }
}

/**
 * Write the invite to the interview it books, creating or updating.
 *
 * The UID is what makes a reschedule an edit rather than a second interview on
 * the board, and it is also why this is an update-then-insert rather than an
 * upsert: the row may already exist from a hand-entered interview or from the
 * prose path, and adopting that row is better than leaving a duplicate beside
 * it.
 */
async function applyInvite(
  supabase: AppSupabaseClient,
  opts: {
    userId: string;
    applicationId: string;
    invite: InviteInterview;
    fallbackKind: string | null;
  },
): Promise<void> {
  const { invite } = opts;
  const companyId = await companyForApplication(supabase, opts.applicationId);

  const patch: Record<string, unknown> = {
    scheduled_at: invite.scheduledAt,
    ics_uid: invite.icsUid,
    ics_sequence: invite.icsSequence,
    status: invite.cancelled ? 'cancelled' : 'scheduled',
    ...(invite.durationMinutes != null ? { duration_minutes: invite.durationMinutes } : {}),
    ...(invite.format ? { format: invite.format } : {}),
    ...(invite.meetingUrl ? { meeting_url: invite.meetingUrl } : {}),
    ...(invite.location ? { location: invite.location } : {}),
    ...(invite.timeZone ? { time_zone: invite.timeZone } : {}),
  };

  const existing = invite.icsUid
    ? await supabase
        .from('interviews')
        .select('id, ics_sequence')
        .eq('application_id', opts.applicationId)
        .eq('ics_uid', invite.icsUid)
        .maybeSingle()
    : { data: null };

  if (existing.data) {
    // Mail arrives out of order. A stale redelivery must not un-cancel a slot.
    if (!inviteSupersedes(invite, { icsSequence: existing.data.ics_sequence as number | null })) {
      return;
    }
    await supabase.from('interviews').update(patch).eq('id', existing.data.id);
    await recordParticipants(supabase, {
      userId: opts.userId,
      companyId,
      interviewId: existing.data.id as string,
      invite,
    });
    return;
  }

  // A cancellation for an interview we never recorded is nothing to record.
  if (invite.cancelled) return;

  const { count } = await supabase
    .from('interviews')
    .select('id', { count: 'exact', head: true })
    .eq('application_id', opts.applicationId);

  const { data: created } = await supabase
    .from('interviews')
    .insert({
      user_id: opts.userId,
      application_id: opts.applicationId,
      round: (count ?? 0) + 1,
      kind: opts.fallbackKind ?? 'recruiter_screen',
      format: invite.format ?? 'video',
      ...patch,
    })
    .select('id')
    .single();

  if (created) {
    await recordParticipants(supabase, {
      userId: opts.userId,
      companyId,
      interviewId: created.id as string,
      invite,
    });
  }
}

/** The company a pursuit is at, for hanging contacts off. */
async function companyForApplication(
  supabase: AppSupabaseClient,
  applicationId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('applications')
    .select('roles!inner ( company_id )')
    .eq('id', applicationId)
    .maybeSingle();
  const roles = (data as { roles?: { company_id: string } } | null)?.roles;
  return roles?.company_id ?? null;
}

/**
 * A contact row for a person the mail named, without making a second one.
 *
 * Identity is the person, not the address. Within one company the name is who
 * they are -- the same recruiter wrote from @eliseai.com and @meetelise.com,
 * and two rows for that reads as a bug -- so a name match at the company wins,
 * and an address found later fills a blank rather than forking the row. Only
 * where there is no company does the address carry identity on its own.
 *
 * Blanks are filled and nothing else is overwritten. Someone who has edited a
 * contact has said something, and an email header does not overrule it.
 */
async function upsertContact(
  supabase: AppSupabaseClient,
  opts: { userId: string; companyId: string | null; contact: CandidateContact },
): Promise<string | null> {
  const { contact } = opts;
  const email = contact.email?.toLowerCase() ?? null;

  if (opts.companyId) {
    const { data: byName } = await supabase
      .from('contacts')
      .select('id, email')
      .eq('user_id', opts.userId)
      .eq('company_id', opts.companyId)
      .ilike('full_name', contact.fullName)
      .maybeSingle();

    if (byName?.id) {
      if (email && !byName.email) {
        await supabase.from('contacts').update({ email }).eq('id', byName.id);
      }
      return byName.id as string;
    }
  }

  if (email) {
    const { data: byEmail } = await supabase
      .from('contacts')
      .select('id')
      .eq('user_id', opts.userId)
      .eq('email', email)
      .maybeSingle();
    if (byEmail?.id) return byEmail.id as string;
  }

  const { data: created, error } = await supabase
    .from('contacts')
    .insert({
      user_id: opts.userId,
      company_id: opts.companyId,
      full_name: contact.fullName,
      email,
      relationship: contact.relationship,
      status: 'responded',
    })
    .select('id')
    .maybeSingle();

  if (created?.id) return created.id as string;

  // Lost a race against another message from the same person in this batch.
  // Both unique keys are partial, so which one caught it depends on the row.
  if (error) {
    const { data: raced } = email
      ? await supabase
          .from('contacts')
          .select('id')
          .eq('user_id', opts.userId)
          .eq('email', email)
          .maybeSingle()
      : await supabase
          .from('contacts')
          .select('id')
          .eq('user_id', opts.userId)
          .eq('company_id', opts.companyId ?? '')
          .ilike('full_name', contact.fullName)
          .maybeSingle();
    return (raced?.id as string) ?? null;
  }

  return null;
}

/** Everyone on the invite, attached to the interview it books. */
async function recordParticipants(
  supabase: AppSupabaseClient,
  opts: {
    userId: string;
    companyId: string | null;
    interviewId: string;
    invite: InviteInterview;
  },
): Promise<void> {
  for (const person of contactsFromInvite(opts.invite)) {
    const contactId = await upsertContact(supabase, {
      userId: opts.userId,
      companyId: opts.companyId,
      contact: person,
    });
    if (!contactId) continue;

    await supabase
      .from('interview_participants')
      .upsert(
        { interview_id: opts.interviewId, contact_id: contactId, role: 'interviewer' },
        { onConflict: 'interview_id,contact_id', ignoreDuplicates: true },
      );
  }
}

function defaultSummary(classification: MessageClassification): string {
  switch (classification) {
    case 'application_confirmation':
      return 'Application confirmed by the employer';
    case 'rejection':
      return 'Rejection received';
    case 'interview_invite':
      return 'Interview invitation received';
    case 'scheduling':
      return 'Interview scheduling message';
    case 'assessment':
      return 'Assessment or take-home received';
    case 'offer':
      return 'Offer received';
    case 'recruiter_reply':
      return 'Reply from the recruiter';
    case 'recruiter_outreach':
      return 'Recruiter reached out';
    default:
      return 'Message linked to this application';
  }
}

/**
 * Create the application a confirmation implies but nobody logged.
 *
 * The one exception to "never auto-create", and the feature that makes the app
 * worth building: you applied through a portal and never logged it, which is
 * most of the time. It appears in the pipeline immediately, flagged, asking you
 * to confirm the details rather than asking you to remember it existed.
 */
/**
 * The company id for a decision, creating the company when the message named
 * one we do not have.
 *
 * Idempotent through the slug: a first scan brings in a dozen messages from the
 * same employer, and they must converge on one row rather than a dozen. The
 * unique index on (user_id, slug) is the real guarantee — the select is the
 * fast path, and the insert conflict is what makes concurrency safe.
 */
async function resolveCompanyId(
  supabase: AppSupabaseClient,
  userId: string,
  company: LinkCompany,
): Promise<string | null> {
  if (company.kind === 'existing') {
    // A name match proves the domain belongs to this company just as surely
    // as the domain match below does -- recording it is what lets the next
    // message from the same recruiter link by domain instead of falling
    // through to the same weak signals again.
    if (company.domainToLearn) {
      const { data: current } = await supabase
        .from('companies')
        .select('domains')
        .eq('id', company.id)
        .maybeSingle();
      const domains = (current?.domains as string[] | null) ?? [];
      if (!domains.includes(company.domainToLearn)) {
        await supabase
          .from('companies')
          .update({ domains: [...domains, company.domainToLearn] })
          .eq('id', company.id);
      }
    }
    return company.id;
  }

  const slug = slugify(company.name);

  const { data: existing } = await supabase
    .from('companies')
    .select('id, domains')
    .eq('user_id', userId)
    .eq('slug', slug)
    .maybeSingle();

  if (existing) {
    // Top up the domain if this message taught us one. This is what makes the
    // *next* message from the same employer link by domain instead of guessing.
    const domains = (existing.domains as string[] | null) ?? [];
    if (company.domain && !domains.includes(company.domain)) {
      await supabase
        .from('companies')
        .update({ domains: [...domains, company.domain] })
        .eq('id', existing.id);
    }
    return existing.id as string;
  }

  const { data, error } = await supabase
    .from('companies')
    .insert({
      user_id: userId,
      name: company.name,
      slug,
      domains: company.domain ? [company.domain] : [],
    })
    .select('id')
    .single();

  if (error) {
    // Another message in the same batch got there first.
    const { data: raced } = await supabase
      .from('companies')
      .select('id')
      .eq('user_id', userId)
      .eq('slug', slug)
      .maybeSingle();
    if (raced) return raced.id as string;
    console.error('inferred company insert failed', error.message);
    return null;
  }

  return data.id as string;
}

/**
 * Remember which ATS subdomain a company's mail arrives from.
 *
 * `ramp.greenhouse.io` says two things at once: this employer uses Greenhouse,
 * and their board is probably called `ramp`. Both were already worked out
 * during classification and then thrown away with the rest of the tier-A
 * result, because linking had no use for them.
 *
 * The JD backfill does. Almost no confirmation email links to the posting, so
 * the sending subdomain is frequently the only thing in the entire mailbox that
 * points at the board — and a board is all the fetchers need.
 *
 * Written as a HINT, never as `ats_board_token`: that column means a board has
 * answered to it. This one means it is worth asking. Discovery promotes the one
 * to the other, and only after the board proves to be this company's.
 */
async function learnBoardHint(
  supabase: AppSupabaseClient,
  companyId: string,
  hint: string | null,
  vendor: AtsVendor,
): Promise<void> {
  const knownVendor = isBoardVendor(vendor);
  if (!hint && !knownVendor) return;

  const { data: company } = await supabase
    .from('companies')
    .select('ats_type, ats_board_token, ats_board_hint')
    .eq('id', companyId)
    .maybeSingle();
  if (!company) return;

  const patch: Record<string, unknown> = {};
  // A proven token outranks a hint, and a hint already recorded is not
  // improved by a second message saying the same thing.
  if (hint && !company.ats_board_token && !company.ats_board_hint) {
    patch.ats_board_hint = hint;
  }
  if (knownVendor && (!company.ats_type || company.ats_type === 'unknown')) {
    patch.ats_type = vendor;
  }
  if (Object.keys(patch).length === 0) return;

  await supabase.from('companies').update(patch).eq('id', companyId);
}

/**
 * How the seeded `submitted` event reads, by the mail it was inferred from.
 *
 * Only a confirmation dates the application itself. A rejection or an offer
 * says an application existed without saying when it was sent, and the row
 * says so rather than presenting the mail's date as the submission date.
 */
const SEED_SUMMARY: Record<string, string> = {
  application_confirmation: 'Inferred from a confirmation email — confirm the details',
  rejection: 'Inferred from a rejection — the application itself was never captured',
  assessment: 'Inferred from an assessment invitation — confirm when you applied',
  offer: 'Inferred from an offer email — confirm when you applied',
};

async function createInferredApplication(
  supabase: AppSupabaseClient,
  opts: {
    userId: string;
    companyId: string;
    roleTitle: string | null;
    atsJobId: string | null;
    receivedAt: Date | null;
    asLead: boolean;
    /** What the pursuit was inferred from, for the seed event's summary. */
    seededBy?: MessageClassification;
    /** Whether opening this is a judgement only the user can make. */
    needsReview: boolean;
  },
): Promise<{ applicationId: string; adopted: boolean } | null> {
  const title = opts.roleTitle?.trim() || PLACEHOLDER_ROLE_TITLE;

  const { data: existingRoles } = await supabase
    .from('roles')
    .select('id, title, applications ( id, status )')
    .eq('user_id', opts.userId)
    .eq('company_id', opts.companyId);

  const open: OpenPursuit[] = [];
  for (const role of existingRoles ?? []) {
    const applications = (role.applications ?? []) as Array<{ id: string; status: string }>;
    const live = applications.find((a) => !isTerminal(a.status as ApplicationStatus));
    if (live) {
      open.push({
        roleId: role.id as string,
        roleTitle: role.title as string,
        applicationId: live.id,
      });
    }
  }

  const choice = choosePursuit(open, title);

  if (choice.kind === 'rename') {
    // The message that names the role arrives after one that could not. Adopt
    // the placeholder and give it the name, rather than leaving a nameless row
    // beside a named one.
    await supabase
      .from('roles')
      .update({ title, ...(opts.atsJobId ? { ats_job_id: opts.atsJobId } : {}) })
      .eq('id', choice.roleId)
      .eq('user_id', opts.userId);
  }

  // Adopted, not created. The caller has to know: an interview invite for a
  // pursuit that already exists is an event that moves it forward, not the
  // birth of a lead.
  if (choice.kind !== 'create') return { applicationId: choice.applicationId, adopted: true };

  const { data: role, error: roleError } = await supabase
    .from('roles')
    .insert({
      user_id: opts.userId,
      company_id: opts.companyId,
      title,
      ats_job_id: opts.atsJobId,
      source: opts.asLead ? 'recruiter_inbound' : 'portal',
      first_seen_at: opts.receivedAt?.toISOString() ?? new Date().toISOString(),
    })
    .select('id')
    .single();

  if (roleError || !role) {
    console.error('inferred role insert failed', roleError?.message);
    return null;
  }

  const { data: application, error } = await supabase
    .from('applications')
    .insert({
      user_id: opts.userId,
      role_id: role.id,
      source: opts.asLead ? 'recruiter_inbound' : 'portal',
      created_by: 'email_inferred',
      // Flagged only where there is something to decide -- see
      // lib/jobs/review/flagging. Everything created here stays visible and
      // editable whether or not it is flagged; the flag is what claims your
      // attention, and claiming it for all of them meant claiming it for none.
      needs_review: opts.needsReview,
      submitted_at: opts.asLead ? null : (opts.receivedAt?.toISOString() ?? null),
    })
    .select('id')
    .single();

  if (error || !application) {
    console.error('inferred application insert failed', error?.message);
    return null;
  }

  if (!opts.asLead) {
    await supabase.from('application_events').insert({
      user_id: opts.userId,
      application_id: application.id,
      kind: 'submitted',
      occurred_at: opts.receivedAt?.toISOString() ?? new Date().toISOString(),
      source: 'system',
      // The date is the mail's, not the application's, and for anything but a
      // confirmation that is a guess -- so the summary says which message it
      // came from rather than implying the send date is known.
      summary: SEED_SUMMARY[opts.seededBy ?? 'application_confirmation'],
      // Provenance, not a decision. The application row carries the review
      // flag if there is anything to decide; flagging its own seed event as
      // well only doubled the queue with rows that ask nothing.
      needs_review: false,
    });
  }

  return { applicationId: application.id, adopted: false };
}

export interface IngestContext {
  userId: string;
  accountId: string;
  accessToken: string;
  /** The connected address, so you are not listed as your own interviewer. */
  accountEmail: string | null;
  /**
   * The profile timezone, applied to invites that carry a wall-clock time with
   * no zone at all. Those are rare and they are also the ones a wrong default
   * silently moves by several hours.
   */
  timezone: string | null;
  companies: CompanyDomainHit[];
  candidates: LinkCandidate[];
  /** The user's own additions to the ignored-sender list; see excluded_senders. */
  excludedDomains: string[];
  counters: IngestCounters;
}

/**
 * Classify, extract, link and persist a page of Gmail message ids.
 *
 * Two passes: metadata-only classification for everything (cheap, and correctly
 * discards most of the volume), then full body plus extraction only for the
 * messages that survived. Re-running is safe — the unique index on
 * (email_account_id, provider_message_id) is what makes that true.
 */
export async function linkEnvelopes(
  supabase: AppSupabaseClient,
  ctx: IngestContext,
  envelopes: MessageEnvelope[],
): Promise<void> {
  if (envelopes.length === 0) return;

  const { data: existingRows } = await supabase
    .from('ingested_messages')
    .select('id, classification, parse_status')
    .in(
      'id',
      envelopes.map((e) => e.id),
    );

  const existing = new Map((existingRows ?? []).map((row) => [row.id as string, row]));

  type Pending = {
    envelope: MessageEnvelope;
    tierA: ClassifyResult;
  };
  const needsBody: Pending[] = [];

  // No pool and no Gmail call: core already fetched every header, once, for
  // both workspaces. Tier A is pure computation over what it handed us.
  for (const envelope of envelopes) {
    const messageId = envelope.providerMessageId;
    const coreId = envelope.id;
    ctx.counters.messagesSeen += 1;

    const prior = existing.get(coreId);
    // A message held for review is retried on later syncs: the application it
    // belongs to may have been created since.
    const retryable =
      prior &&
      (prior.parse_status === 'needs_review' || prior.parse_status === 'failed') &&
      prior.classification !== 'not_relevant';

    if (prior && !retryable) {
      ctx.counters.skipped += 1;
      continue;
    }

    const tierA = classifyMessage({
      fromAddress: envelope.fromAddress,
      replyToAddress: envelope.replyToAddress,
      subject: envelope.subject,
      companies: ctx.companies,
      excludedDomains: ctx.excludedDomains,
    });
    ctx.counters.messagesClassified += 1;

    // Board digests and confidently-irrelevant mail stop here. The verdict is
    // still written: saying "not mine" is what lets core work out that nobody
    // claimed the message and scrub the envelope.
    if (tierA.classification === 'job_alert' || tierA.classification === 'networking') {
      await writeLedger(supabase, {
        coreId,
        providerMessageId: messageId,
        classification: tierA.classification,
        parseStatus: 'skipped',
      });
      ctx.counters.skipped += 1;
      continue;
    }

    if (tierA.classification === 'not_relevant' && tierA.tier === 'A') {
      await writeLedger(supabase, {
        coreId,
        providerMessageId: messageId,
        classification: 'not_relevant',
        parseStatus: 'skipped',
      });
      ctx.counters.skipped += 1;
      continue;
    }

    needsBody.push({ envelope, tierA });
  }

  await mapPool(needsBody, EXTRACT_CONCURRENCY, async (pending) => {
    try {
      const message = await gmailProvider.getMessage(
        ctx.accessToken,
        pending.envelope.providerMessageId,
        { format: 'full' },
      );
      message.fromAddress ??= pending.envelope.fromAddress;
      message.replyToAddress ??= pending.envelope.replyToAddress;
      message.subject ??= pending.envelope.subject;
      message.internalDate ??= pending.envelope.receivedAt
        ? new Date(pending.envelope.receivedAt)
        : null;
      message.threadId ??= pending.envelope.threadId;

      // Re-run Tier A with the body: rejections are decided by the body, since
      // their subject line is indistinguishable from a confirmation's.
      const tierA = classifyMessage({
        fromAddress: message.fromAddress,
        replyToAddress: message.replyToAddress,
        subject: message.subject,
        bodyPreview: message.text.slice(0, 2000),
        companies: ctx.companies,
        excludedDomains: ctx.excludedDomains,
      });

      await handleMessage(supabase, ctx, {
        message,
        tierA,
        coreId: pending.envelope.id,
      });
    } catch (error) {
      ctx.counters.errors += 1;
      console.error('message ingest failed', pending.envelope.providerMessageId, {
        name: error instanceof Error ? error.name : 'unknown',
      });
    }
  });
}

async function handleMessage(
  supabase: AppSupabaseClient,
  ctx: IngestContext,
  input: { message: FetchedMessage; tierA: ClassifyResult; coreId: string },
): Promise<void> {
  const { message, tierA, coreId } = input;

  if (tierA.classification === 'not_relevant' && tierA.tier === 'A') {
    await writeLedger(supabase, {
      coreId,
      providerMessageId: message.id,
      classification: 'not_relevant',
      parseStatus: 'skipped',
    });
    ctx.counters.skipped += 1;
    return;
  }

  // Tier B only for what Tier A could not place, or where the body carries
  // structure Tier A cannot see (dates, job ids, interviewer names).
  const needsModel = tierA.tier !== 'A' || ACTIONABLE.has(tierA.classification);
  const tierB = needsModel
    ? await extractWithModel({
        subject: message.subject,
        fromAddress: message.fromAddress,
        replyToAddress: message.replyToAddress,
        body: message.text,
        tierA,
      })
    : { extracted: null, parserVersion: PARSER_VERSION };

  const classification = reconcileClassification(tierA, tierB.extracted);

  if (classification === 'not_relevant' || classification === 'job_alert') {
    await writeLedger(supabase, {
      coreId,
      providerMessageId: message.id,
      classification,
      parseStatus: 'skipped',
    });
    ctx.counters.skipped += 1;
    return;
  }

  const decision = decideLink(
    {
      threadId: message.threadId,
      fromAddress: message.fromAddress,
      replyToAddress: message.replyToAddress,
      subject: message.subject,
      bodyPreview: message.text.slice(0, 2000),
      receivedAt: message.internalDate,
      classification,
      extractedCompany: tierB.extracted?.companyName ?? null,
      extractedRole: tierB.extracted?.roleTitle ?? null,
      extractedAtsJobId: tierB.extracted?.atsJobId ?? null,
      companyHint: tierA.companyHint,
    },
    ctx.candidates,
    { companies: ctx.companies.map((c) => ({ id: c.id, name: c.name, domains: c.domains })) },
  );

  await applyDecision(supabase, ctx, {
    message,
    classification,
    // The evidence, not just the conclusion: whether a deterministic rule or a
    // model settled this is what decides if the row needs your eyes.
    tierA,
    tierB: tierB.extracted,
    decision,
    coreId,
    // Parsed once per message rather than per branch: two of the three
    // branches below write an event, and both want the same answer.
    invite: inviteFromMessage(message, ctx),
  });
}

async function applyDecision(
  supabase: AppSupabaseClient,
  ctx: IngestContext,
  input: {
    message: FetchedMessage;
    classification: MessageClassification;
    tierA: ClassifyResult;
    tierB: ExtractedMessage | null;
    decision: LinkDecision;
    coreId: string;
    invite: InviteInterview | null;
  },
): Promise<void> {
  const { message, classification, tierA, tierB, decision, coreId, invite } = input;

  const ledger = async (
    parseStatus: 'parsed' | 'needs_review' | 'failed',
    extra: {
      applicationId?: string | null;
      linkConfidence?: number | null;
      linkMethod?: string | null;
      error?: string | null;
    } = {},
  ) =>
    writeLedger(supabase, {
      coreId,
      providerMessageId: message.id,
      classification,
      parseStatus,
      parseConfidence: tierB?.confidence ?? null,
      ...extra,
    });

  switch (decision.action) {
    case 'link': {
      const verified = verifyExtraction(
        tierB ?? {
          classification,
          dates: [],
          interviewerNames: [],
          actionRequired: false,
          summary: 'Linked message',
          confidence: 0.5,
        },
        {
          companyResolvable: true,
          receivedAt: message.internalDate,
          applicationSubmittedAt: decision.candidate.submittedAt,
          transitionLegal: true,
        },
      );

      if (!verified.ok) {
        await ledger('needs_review', {
          applicationId: decision.candidate.applicationId,
          linkConfidence: decision.confidence,
          linkMethod: decision.method,
          error: verified.detail,
        });
        ctx.counters.heldForReview += 1;
        return;
      }

      const ledgerId = await ledger('parsed', {
        applicationId: decision.candidate.applicationId,
        linkConfidence: decision.confidence,
        linkMethod: decision.method,
      });

      await writeEvent(supabase, {
        userId: ctx.userId,
        applicationId: decision.candidate.applicationId,
        ledgerId,
        classification,
        extracted: tierB,
        message,
        invite,
        accountEmail: ctx.accountEmail,
      });
      ctx.counters.messagesParsed += 1;
      return;
    }

    case 'review': {
      await ledger('needs_review', {
        linkConfidence: decision.candidates[0]?.confidence ?? null,
        linkMethod: decision.candidates[0]?.method ?? null,
        error: decision.reason,
      });
      ctx.counters.heldForReview += 1;
      return;
    }

    case 'create_inferred_application': {
      const companyId = await resolveCompanyId(supabase, ctx.userId, decision.company);
      if (!companyId) {
        await ledger('needs_review', { error: 'Could not record the company for this message.' });
        ctx.counters.heldForReview += 1;
        return;
      }

      await learnBoardHint(supabase, companyId, tierA.companyHint, tierA.ats);

      const created = await createInferredApplication(supabase, {
        userId: ctx.userId,
        companyId,
        roleTitle: tierB?.roleTitle ?? null,
        atsJobId: tierB?.atsJobId ?? null,
        receivedAt: message.internalDate,
        asLead: false,
        seededBy: classification,
        needsReview: inferredApplicationNeedsReview({
          path: 'application',
          classification,
          tier: tierA.tier,
          ats: tierA.ats,
          companyKind: decision.company.kind,
        }),
      });

      if (!created) {
        await ledger('failed', { error: 'Could not create the inferred application.' });
        ctx.counters.errors += 1;
        return;
      }

      const applicationId = created.applicationId;

      const ledgerId = await ledger('parsed', {
        applicationId,
        linkConfidence: decision.confidence,
        linkMethod: `inferred_from_${classification}`,
      });

      await writeEvent(supabase, {
        userId: ctx.userId,
        applicationId,
        ledgerId,
        classification,
        extracted: tierB,
        message,
        invite,
        accountEmail: ctx.accountEmail,
      });

      ctx.counters.applicationsCreated += 1;
      ctx.counters.messagesParsed += 1;
      return;
    }

    case 'create_lead': {
      const companyId = await resolveCompanyId(supabase, ctx.userId, decision.company);
      if (!companyId) {
        await ledger('needs_review', { error: 'Could not record the company for this message.' });
        ctx.counters.heldForReview += 1;
        return;
      }

      await learnBoardHint(supabase, companyId, tierA.companyHint, tierA.ats);

      const lead = await createInferredApplication(supabase, {
        userId: ctx.userId,
        companyId,
        roleTitle: tierB?.roleTitle ?? null,
        atsJobId: tierB?.atsJobId ?? null,
        receivedAt: message.internalDate,
        asLead: true,
        needsReview: inferredApplicationNeedsReview({
          path: 'lead',
          classification,
          tier: tierA.tier,
          ats: tierA.ats,
          companyKind: decision.company.kind,
        }),
      });

      if (!lead) {
        await ledger('failed', { error: 'Could not create the lead.' });
        ctx.counters.errors += 1;
        return;
      }

      const applicationId = lead.applicationId;

      const ledgerId = await ledger('parsed', {
        applicationId,
        linkConfidence: 0.5,
        linkMethod: lead.adopted ? 'matched_open_pursuit' : 'lead_from_inbound',
      });

      if (lead.adopted) {
        // Not a lead at all. The dedupe found an open pursuit at this company
        // with this title, which means the message is about something already
        // on the board -- so it gets its real event and moves the status.
        //
        // This is what an interview invite landing here used to lose: it was
        // classified correctly, attached to the right application, and then
        // recorded as a flat note, so a pursuit with an interview booked still
        // read as merely acknowledged.
        await writeEvent(supabase, {
          userId: ctx.userId,
          applicationId,
          ledgerId,
          classification,
          extracted: tierB,
          message,
          invite,
          accountEmail: ctx.accountEmail,
        });
      } else {
        // A genuinely new lead has no application to advance, so the inbound is
        // recorded as a note rather than as a status-moving event.
        await supabase.from('application_events').insert({
          user_id: ctx.userId,
          application_id: applicationId,
          kind: 'note',
          occurred_at: message.internalDate?.toISOString() ?? new Date().toISOString(),
          source: 'email',
          ingested_message_id: ledgerId,
          summary: tierB?.summary ?? 'Inbound about a role you have not applied to',
        });
      }

      ctx.counters.leadsCreated += 1;
      ctx.counters.messagesParsed += 1;
      return;
    }

    case 'hold': {
      await ledger('needs_review', { error: decision.reason });
      ctx.counters.heldForReview += 1;
      return;
    }
  }
}

/**
 * Give held messages another look, using what the sync just learned.
 *
 * The review queue is not a dead letter office. A message is held because
 * nothing on file matched it, and "on file" changes constantly: the batch that
 * just landed may have created the company or the application this message has
 * been waiting for. Without this, a message held on a first scan stays held
 * until a *later* sync happens to re-list it, which for incremental syncs is
 * never — they only offer mail that has just arrived.
 *
 * Envelopes are rebuilt from the view rather than refetched: the verdict is
 * ours, but the sender, subject and date are core's, and both halves are needed
 * to run the linker again.
 */
export async function reprocessHeldMessages(
  supabase: AppSupabaseClient,
  ctx: IngestContext,
  opts: { limit?: number; budgetMs?: number } = {},
): Promise<void> {
  const { data: pending } = await supabase
    .from('inbox_messages')
    .select('id, provider_message_id, thread_id, received_at, from_address, reply_to_address, subject')
    .eq('email_account_id', ctx.accountId)
    .eq('parse_status', 'needs_review')
    .neq('classification', 'not_relevant')
    // Each retry costs a body fetch and usually a model call, so a message that
    // is not going to resolve stops being re-read. The counter resets when a
    // sync creates something, which is when a retry is worth paying for again.
    .lt('relink_attempts', MAX_RELINK_ATTEMPTS)
    .order('received_at', { ascending: true })
    .limit(opts.limit ?? RELINK_BATCH);

  const envelopes: MessageEnvelope[] = (pending ?? []).map((row) => ({
    id: row.id as string,
    providerMessageId: row.provider_message_id as string,
    threadId: (row.thread_id as string | null) ?? null,
    receivedAt: (row.received_at as string | null) ?? null,
    fromAddress: (row.from_address as string | null) ?? null,
    replyToAddress: (row.reply_to_address as string | null) ?? null,
    subject: (row.subject as string | null) ?? null,
    isNew: false,
  }));

  if (envelopes.length === 0) return;

  // Oldest first, in chunks, stopping when the budget is spent. A message that
  // is still unlinkable after this stays in the queue for you to decide, which
  // is what the queue is for.
  const startedAt = Date.now();
  const budgetMs = opts.budgetMs ?? RELINK_BUDGET_MS;

  for (let i = 0; i < envelopes.length; i += RELINK_CHUNK) {
    if (Date.now() - startedAt > budgetMs) break;
    const chunk = envelopes.slice(i, i + RELINK_CHUNK);

    // Charged before the chunk runs, not after: an invocation killed mid-pass
    // has still spent the fetches, and not counting them is how a run that
    // always dies at the same message re-reads it on every sync forever.
    await bumpRelinkAttempts(
      supabase,
      chunk.map((envelope) => envelope.id),
    );
    await linkEnvelopes(supabase, ctx, chunk);
  }
}

/** How many times a held message is re-read before it waits for you instead. */
const MAX_RELINK_ATTEMPTS = 3;
/**
 * Per sync, and deliberately small.
 *
 * The sync route already times out at sixty seconds occasionally without this
 * pass, and every message here costs a body fetch plus usually a model call. A
 * backlog is cleared over several syncs; a backlog cleared in one sync that
 * times out clears nothing at all, because the whole invocation is lost.
 */
const RELINK_BATCH = 12;
/** Chunk size, so the budget below is checked often enough to matter. */
const RELINK_CHUNK = 4;
/** Wall clock this pass may spend before leaving the rest for the next sync. */
const RELINK_BUDGET_MS = 20_000;

async function bumpRelinkAttempts(
  supabase: AppSupabaseClient,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.rpc('bump_relink_attempts', { message_ids: ids });
  if (error) console.error('relink attempt bump failed', error.message);
}

/**
 * Everything held becomes worth another look again.
 *
 * Called when a sync creates a company or an application, because that is
 * exactly the change that can make a previously unlinkable message linkable —
 * and without the reset, a message that used up its retries before its
 * application existed would never be looked at again.
 */
export async function resetRelinkAttempts(
  supabase: AppSupabaseClient,
  accountId: string,
): Promise<void> {
  const { data: held } = await supabase
    .from('inbox_messages')
    .select('id')
    .eq('email_account_id', accountId)
    .eq('parse_status', 'needs_review')
    .gt('relink_attempts', 0);

  const ids = (held ?? []).map((row) => row.id as string);
  if (ids.length === 0) return;

  const { error } = await supabase
    .from('ingested_messages')
    .update({ relink_attempts: 0 })
    .in('id', ids);
  if (error) console.error('relink attempt reset failed', error.message);
}

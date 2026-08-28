import 'server-only';

import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
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
import { decideLink, type LinkCandidate, type LinkDecision } from '@/lib/jobs/email/link';
import { gmailProvider } from '@/lib/jobs/email/providers/gmail';
import { isTerminal, type ApplicationStatus } from '@/lib/jobs/pipeline';
import { extractWithModel, reconcileClassification } from '@/lib/jobs/inbox/tier-b';


/** Parallel Gmail metadata fetches — well under the per-user rate quota. */
const METADATA_CONCURRENCY = 5;
/** Full body + model extraction. Lower, because each one costs money. */
const EXTRACT_CONCURRENCY = 2;

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
    ledgerId: string | null;
    accountId: string;
    message: FetchedMessage;
    classification: MessageClassification;
    parseStatus: 'pending' | 'parsed' | 'failed' | 'skipped' | 'needs_review';
    applicationId?: string | null;
    linkConfidence?: number | null;
    linkMethod?: string | null;
    parseConfidence?: number | null;
    error?: string | null;
  },
): Promise<string | null> {
  const bare = opts.classification === 'not_relevant';

  const row = {
    email_account_id: opts.accountId,
    provider_message_id: opts.message.id,
    thread_id: bare ? null : opts.message.threadId,
    received_at: opts.message.internalDate?.toISOString() ?? null,
    from_address: bare ? null : opts.message.fromAddress,
    reply_to_address: bare ? null : opts.message.replyToAddress,
    subject: bare ? null : opts.message.subject,
    classification: opts.classification,
    parse_status: opts.parseStatus,
    parser_version: PARSER_VERSION,
    resulting_application_id: opts.applicationId ?? null,
    link_confidence: opts.linkConfidence ?? null,
    link_method: opts.linkMethod ?? null,
    parse_confidence: opts.parseConfidence ?? null,
    error: opts.error ?? null,
  };

  if (opts.ledgerId) {
    await supabase.from('ingested_messages').update(row).eq('id', opts.ledgerId);
    return opts.ledgerId;
  }

  const { data, error } = await supabase
    .from('ingested_messages')
    .insert(row)
    .select('id')
    .single();

  if (error) {
    // A duplicate here means a concurrent sync got there first, which is fine.
    if (!/duplicate|unique/i.test(error.message)) {
      console.error('ledger insert failed', opts.message.id, error.message);
    }
    return null;
  }
  return data?.id ?? null;
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
  if (!isTerminal(currentStatus)) return true;
  // Nothing reopens a terminal application from the inbox.
  return false;
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

async function writeEvent(
  supabase: AppSupabaseClient,
  opts: {
    userId: string;
    applicationId: string;
    ledgerId: string | null;
    classification: MessageClassification;
    extracted: ExtractedMessage | null;
    message: FetchedMessage;
  },
): Promise<void> {
  const kind = eventKindFor(opts.classification);
  if (!kind) return;

  const status = await currentStatus(supabase, opts.applicationId);
  const legal = transitionIsLegal(status, kind);

  const interviewKind = opts.extracted?.interviewKind ?? null;
  const occurredAt =
    opts.extracted?.dates?.find((d) => d.kind === 'interview')?.at ??
    opts.message.internalDate?.toISOString() ??
    new Date().toISOString();

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
      ...(opts.extracted?.interviewerNames?.length
        ? { interviewers: opts.extracted.interviewerNames }
        : {}),
      ...(opts.extracted?.actionRequired ? { action_required: true } : {}),
      scheduled_at: occurredAt,
    },
    needs_review: !legal,
  });

  // The interview row itself, when the mail carried a real date with a zone.
  const interviewDate = opts.extracted?.dates?.find((d) => d.kind === 'interview');
  if (interviewDate && legal && (kind === 'interview_scheduled' || kind === 'screen_scheduled')) {
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
async function createInferredApplication(
  supabase: AppSupabaseClient,
  opts: {
    userId: string;
    companyId: string;
    roleTitle: string | null;
    atsJobId: string | null;
    receivedAt: Date | null;
    asLead: boolean;
  },
): Promise<string | null> {
  const title = opts.roleTitle?.trim() || 'Role from email';

  // Never a duplicate: an open application at this company with this title is
  // the one this message belongs to, and the linker simply scored it too low.
  const { data: existingRoles } = await supabase
    .from('roles')
    .select('id, title, applications ( id, status )')
    .eq('user_id', opts.userId)
    .eq('company_id', opts.companyId);

  for (const role of existingRoles ?? []) {
    if ((role.title as string).toLowerCase() !== title.toLowerCase()) continue;
    const applications = (role.applications ?? []) as Array<{ id: string; status: string }>;
    const open = applications.find((a) => !isTerminal(a.status as ApplicationStatus));
    if (open) return open.id;
  }

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
      // Always flagged. An unreviewed inferred row is still visible; an
      // unflagged wrong one silently corrupts the funnel.
      needs_review: true,
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
      summary: 'Inferred from a confirmation email — confirm the details',
      needs_review: true,
    });
  }

  return application.id;
}

export interface IngestContext {
  userId: string;
  accountId: string;
  accessToken: string;
  companies: CompanyDomainHit[];
  candidates: LinkCandidate[];
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
export async function ingestGmailMessageIds(
  supabase: AppSupabaseClient,
  ctx: IngestContext,
  messageIds: string[],
): Promise<void> {
  if (messageIds.length === 0) return;

  const { data: existingRows } = await supabase
    .from('ingested_messages')
    .select('id, provider_message_id, classification, parse_status')
    .eq('email_account_id', ctx.accountId)
    .in('provider_message_id', messageIds);

  const existing = new Map(
    (existingRows ?? []).map((row) => [row.provider_message_id as string, row]),
  );

  type Pending = {
    messageId: string;
    ledgerId: string | null;
    meta: FetchedMessage;
    tierA: ClassifyResult;
  };
  const needsBody: Pending[] = [];

  await mapPool(messageIds, METADATA_CONCURRENCY, async (messageId) => {
    ctx.counters.messagesSeen += 1;

    const prior = existing.get(messageId);
    // A message held for review is retried on later syncs: the application it
    // belongs to may have been created since.
    const retryable =
      prior &&
      (prior.parse_status === 'needs_review' || prior.parse_status === 'failed') &&
      prior.classification !== 'not_relevant';

    if (prior && !retryable) {
      ctx.counters.skipped += 1;
      return;
    }

    try {
      const meta = await gmailProvider.getMessage(ctx.accessToken, messageId, {
        format: 'metadata',
      });
      const tierA = classifyMessage({
        fromAddress: meta.fromAddress,
        replyToAddress: meta.replyToAddress,
        subject: meta.subject,
        companies: ctx.companies,
      });
      ctx.counters.messagesClassified += 1;

      // Board digests and confidently-irrelevant mail stop here, and for
      // not_relevant nothing but the id and the date is written.
      if (tierA.classification === 'job_alert' || tierA.classification === 'networking') {
        await writeLedger(supabase, {
          ledgerId: prior?.id ?? null,
          accountId: ctx.accountId,
          message: meta,
          classification: tierA.classification,
          parseStatus: 'skipped',
        });
        ctx.counters.skipped += 1;
        return;
      }

      if (tierA.classification === 'not_relevant' && tierA.tier === 'A') {
        await writeLedger(supabase, {
          ledgerId: prior?.id ?? null,
          accountId: ctx.accountId,
          message: meta,
          classification: 'not_relevant',
          parseStatus: 'skipped',
        });
        ctx.counters.skipped += 1;
        return;
      }

      needsBody.push({ messageId, ledgerId: prior?.id ?? null, meta, tierA });
    } catch (error) {
      ctx.counters.errors += 1;
      console.error('metadata fetch failed', messageId, {
        name: error instanceof Error ? error.name : 'unknown',
      });
    }
  });

  await mapPool(needsBody, EXTRACT_CONCURRENCY, async (pending) => {
    try {
      const message = await gmailProvider.getMessage(ctx.accessToken, pending.messageId, {
        format: 'full',
      });
      message.fromAddress ??= pending.meta.fromAddress;
      message.replyToAddress ??= pending.meta.replyToAddress;
      message.subject ??= pending.meta.subject;
      message.internalDate ??= pending.meta.internalDate;
      message.threadId ??= pending.meta.threadId;

      // Re-run Tier A with the body: rejections are decided by the body, since
      // their subject line is indistinguishable from a confirmation's.
      const tierA = classifyMessage({
        fromAddress: message.fromAddress,
        replyToAddress: message.replyToAddress,
        subject: message.subject,
        bodyPreview: message.text.slice(0, 2000),
        companies: ctx.companies,
      });

      await handleMessage(supabase, ctx, {
        message,
        tierA,
        ledgerId: pending.ledgerId,
      });
    } catch (error) {
      ctx.counters.errors += 1;
      console.error('message ingest failed', pending.messageId, {
        name: error instanceof Error ? error.name : 'unknown',
      });
    }
  });
}

async function handleMessage(
  supabase: AppSupabaseClient,
  ctx: IngestContext,
  input: { message: FetchedMessage; tierA: ClassifyResult; ledgerId: string | null },
): Promise<void> {
  const { message, tierA } = input;

  if (tierA.classification === 'not_relevant' && tierA.tier === 'A') {
    await writeLedger(supabase, {
      ledgerId: input.ledgerId,
      accountId: ctx.accountId,
      message,
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
      ledgerId: input.ledgerId,
      accountId: ctx.accountId,
      message,
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

  await applyDecision(supabase, ctx, { message, classification, tierB: tierB.extracted, decision, ledgerId: input.ledgerId });
}

async function applyDecision(
  supabase: AppSupabaseClient,
  ctx: IngestContext,
  input: {
    message: FetchedMessage;
    classification: MessageClassification;
    tierB: ExtractedMessage | null;
    decision: LinkDecision;
    ledgerId: string | null;
  },
): Promise<void> {
  const { message, classification, tierB, decision } = input;

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
      ledgerId: input.ledgerId,
      accountId: ctx.accountId,
      message,
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
      const applicationId = await createInferredApplication(supabase, {
        userId: ctx.userId,
        companyId: decision.companyId,
        roleTitle: tierB?.roleTitle ?? null,
        atsJobId: tierB?.atsJobId ?? null,
        receivedAt: message.internalDate,
        asLead: false,
      });

      if (!applicationId) {
        await ledger('failed', { error: 'Could not create the inferred application.' });
        ctx.counters.errors += 1;
        return;
      }

      const ledgerId = await ledger('parsed', {
        applicationId,
        linkConfidence: decision.confidence,
        linkMethod: 'inferred_from_confirmation',
      });

      await writeEvent(supabase, {
        userId: ctx.userId,
        applicationId,
        ledgerId,
        classification,
        extracted: tierB,
        message,
      });

      ctx.counters.applicationsCreated += 1;
      ctx.counters.messagesParsed += 1;
      return;
    }

    case 'create_lead': {
      const applicationId = await createInferredApplication(supabase, {
        userId: ctx.userId,
        companyId: decision.companyId,
        roleTitle: tierB?.roleTitle ?? null,
        atsJobId: tierB?.atsJobId ?? null,
        receivedAt: message.internalDate,
        asLead: true,
      });

      if (!applicationId) {
        await ledger('failed', { error: 'Could not create the lead.' });
        ctx.counters.errors += 1;
        return;
      }

      const ledgerId = await ledger('parsed', {
        applicationId,
        linkConfidence: 0.5,
        linkMethod: 'lead_from_inbound',
      });

      // A lead has no application to advance, so the inbound is recorded as a
      // note on the timeline rather than as a status-moving event.
      await supabase.from('application_events').insert({
        user_id: ctx.userId,
        application_id: applicationId,
        kind: 'note',
        occurred_at: message.internalDate?.toISOString() ?? new Date().toISOString(),
        source: 'email',
        ingested_message_id: ledgerId,
        summary: tierB?.summary ?? 'Inbound about a role you have not applied to',
      });

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

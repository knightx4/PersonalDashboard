import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import {
  highWaterFromRejectionStage,
  requirementCoverage,
  type ApplicationEventKind,
  type ApplicationSource,
  type ApplicationStatus,
  type CoverageEntry,
  type FunnelApplication,
  type RejectionStage,
  type RequirementCoverage,
} from '@/lib/jobs/pipeline';
import { safeTimeZone } from '@/lib/core/timezone';
import { whenDate, whenDay, whenTime, whenZoneName, type WhenInput } from '@/lib/core/when';
import type { ScoreNote } from '@/lib/jobs/suggest/score-notes';
import { lastTurnEvent } from '@/lib/jobs/move';

/**
 * Reading the pipeline.
 *
 * Every list view renders the joined role + company + application object,
 * because the three-level split is a modelling decision and not something the
 * user should have to think about. You never see the word "application" as
 * distinct from "role" unless you have two of them.
 */

export interface PipelineRow {
  applicationId: string;
  roleId: string;
  companyId: string;
  companyName: string;
  companySlug: string;
  companyLogoUrl: string | null;
  /** Both feed the avatar: a stored logo first, the company's own domain next. */
  companyDomains: string[];
  companyWebsite: string | null;
  roleTitle: string;
  location: string | null;
  workMode: string | null;
  status: ApplicationStatus;
  source: ApplicationSource;
  attempt: number;
  excitement: number | null;
  needsReview: boolean;
  /** Marked ready to apply on the role's Application tab. */
  readyToApply: boolean;
  allQuestionsAdded: boolean;
  /** true has a cover letter, false has none, null not answered. */
  hasCoverLetter: boolean | null;
  createdBy: string;
  submittedAt: string | null;
  confirmationReceivedAt: string | null;
  firstHumanResponseAt: string | null;
  closedAt: string | null;
  outcome: string | null;
  rejectionStage: RejectionStage | null;
  nextAction: string | null;
  nextActionDue: string | null;
  lastActivityAt: string | null;
  /**
   * Computed on the server, once. Deriving it in a component would mean calling
   * Date.now() during render, which gives a different answer on every re-render
   * and makes "stale" flicker.
   */
  daysSinceActivity: number | null;
  /**
   * The newest event that says whose turn it is (lib/jobs/move.ts), which
   * with the status gives the card its move.
   */
  lastTurnEvent: ApplicationEventKind | null;
  compMinCents: number | null;
  compMaxCents: number | null;
  /**
   * Must-have coverage from the stored requirement match, or a null rate when
   * the role has never been matched. Derived once here rather than per card,
   * for the same reason `daysSinceActivity` is.
   */
  coverage: RequirementCoverage;
  /** The kind of every interview logged, which is what the funnel's high-water mark reads. */
  interviewKinds?: string[];
  /**
   * The soonest interview still ahead, which the pipeline's In process rows
   * show. Null when none is booked.
   */
  nextInterview?: { at: string; timeKnown: boolean } | null;
  /**
   * Fit and chance with their reasons (plan #1206), attached by the pages that
   * show them (`withApplicationNotes`); absent or null when not scored.
   */
  scoreNote?: ScoreNote | null;
}

const SELECT = `
  id, status, source, attempt, excitement, needs_review, ready_to_apply, all_questions_added, has_cover_letter, created_by,
  submitted_at, confirmation_received_at, first_human_response_at, closed_at,
  outcome, rejection_stage, rejection_stage_override, next_action, next_action_due, created_at,
  roles!inner (
    id, title, location, work_mode, comp_min_cents, comp_max_cents, requirement_matches,
    companies!inner ( id, name, slug, logo_url, domains, website )
  ),
  interviews ( kind, scheduled_at, time_known )
`;

type RawRow = {
  id: string;
  status: ApplicationStatus;
  source: ApplicationSource;
  attempt: number;
  excitement: number | null;
  needs_review: boolean;
  ready_to_apply: boolean | null;
  all_questions_added: boolean | null;
  has_cover_letter: boolean | null;
  created_by: string;
  submitted_at: string | null;
  confirmation_received_at: string | null;
  first_human_response_at: string | null;
  closed_at: string | null;
  outcome: string | null;
  rejection_stage: RejectionStage | null;
  rejection_stage_override: RejectionStage | null;
  next_action: string | null;
  next_action_due: string | null;
  created_at: string;
  roles: {
    id: string;
    title: string;
    location: string | null;
    work_mode: string | null;
    comp_min_cents: number | null;
    comp_max_cents: number | null;
    requirement_matches: CoverageEntry[] | null;
    companies: {
      id: string;
      name: string;
      slug: string;
      logo_url: string | null;
      domains: string[] | null;
      website: string | null;
    };
  };
  interviews: { kind: string; scheduled_at: string | null; time_known: boolean | null }[] | null;
};

export async function loadPipeline(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<PipelineRow[]> {
  const { data, error } = await supabase
    .from('applications')
    .select(SELECT)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  const rows = data as unknown as RawRow[];

  // Last activity drives "stale" everywhere and is what the board sorts by, so
  // it is loaded once for the whole pipeline rather than per card.
  const { data: activity } = await supabase
    .from('application_events')
    .select('application_id, occurred_at, kind')
    .eq('user_id', userId)
    .order('occurred_at', { ascending: false });

  const lastActivity = new Map<string, string>();
  const kinds = new Map<string, string[]>();
  for (const event of activity ?? []) {
    const id = event.application_id as string;
    if (!lastActivity.has(id)) lastActivity.set(id, event.occurred_at as string);
    const list = kinds.get(id);
    if (list) list.push(event.kind as string);
    else kinds.set(id, [event.kind as string]);
  }

  return rows.map((row) => ({
    applicationId: row.id,
    roleId: row.roles.id,
    companyId: row.roles.companies.id,
    companyName: row.roles.companies.name,
    companySlug: row.roles.companies.slug,
    companyLogoUrl: row.roles.companies.logo_url,
    companyDomains: row.roles.companies.domains ?? [],
    companyWebsite: row.roles.companies.website,
    roleTitle: row.roles.title,
    location: row.roles.location,
    workMode: row.roles.work_mode,
    status: row.status,
    source: row.source,
    attempt: row.attempt,
    excitement: row.excitement,
    needsReview: row.needs_review,
    readyToApply: row.ready_to_apply === true,
    allQuestionsAdded: row.all_questions_added === true,
    hasCoverLetter: row.has_cover_letter ?? null,
    createdBy: row.created_by,
    submittedAt: row.submitted_at,
    confirmationReceivedAt: row.confirmation_received_at,
    firstHumanResponseAt: row.first_human_response_at,
    closedAt: row.closed_at,
    outcome: row.outcome,
    rejectionStage: row.rejection_stage_override ?? row.rejection_stage,
    nextAction: row.next_action,
    nextActionDue: row.next_action_due,
    lastActivityAt: lastActivity.get(row.id) ?? row.created_at,
    daysSinceActivity: daysSince(lastActivity.get(row.id) ?? row.created_at),
    lastTurnEvent: lastTurnEvent(kinds.get(row.id) ?? []),
    compMinCents: row.roles.comp_min_cents,
    compMaxCents: row.roles.comp_max_cents,
    coverage: requirementCoverage(row.roles.requirement_matches),
    interviewKinds: (row.interviews ?? []).map((interview) => interview.kind),
    nextInterview: nextInterview(row.interviews ?? []),
  }));
}

function nextInterview(
  interviews: NonNullable<RawRow['interviews']>,
): PipelineRow['nextInterview'] {
  const now = Date.now();
  let soonest: { at: string; timeKnown: boolean } | null = null;
  for (const interview of interviews) {
    if (!interview.scheduled_at) continue;
    const at = new Date(interview.scheduled_at).getTime();
    if (!Number.isFinite(at) || at < now) continue;
    if (!soonest || at < new Date(soonest.at).getTime()) {
      soonest = { at: interview.scheduled_at, timeKnown: interview.time_known ?? true };
    }
  }
  return soonest;
}

/** Flatten to the shape lib/pipeline.ts computes from. */
export function toFunnelApplications(rows: readonly PipelineRow[]): FunnelApplication[] {
  return rows.map((row) => {
    // A pursuit with no submission on file enters the funnel on the first
    // human reply: a recruiter who wrote first leaves nothing to submit, and
    // an application found only through its later mail never had its
    // submission seen. Without this, sixteen inbound pursuits with interviews
    // behind them were left out entirely, and the 59 relabelled as portal
    // (plan #1588) would have been. A lead nobody applied to stays out.
    const enteredAt = row.submittedAt ?? (row.status !== 'lead' ? row.firstHumanResponseAt : null);
    const submittedAt = enteredAt ? new Date(enteredAt) : null;
    const confirmationReceivedAt = row.confirmationReceivedAt
      ? new Date(row.confirmationReceivedAt)
      : null;
    const firstHumanResponseAt = row.firstHumanResponseAt
      ? new Date(row.firstHumanResponseAt)
      : null;
    return {
      id: row.applicationId,
      source: row.source,
      status: row.status,
      submittedAt,
      confirmationReceivedAt,
      firstHumanResponseAt,
      outcome: (row.outcome as FunnelApplication['outcome']) ?? null,
      rejectionStage: row.rejectionStage,
      highWaterStatus: highWaterFromRejectionStage(
        row.status,
        row.rejectionStage,
        submittedAt,
        confirmationReceivedAt,
        firstHumanResponseAt,
        row.interviewKinds,
      ),
      interviewed: (row.interviewKinds ?? []).length > 0,
    };
  });
}

export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  return Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
}

/** "3d", "12d", "—". Tabular figures, so a column of these lines up. */
export function shortAge(iso: string | null): string {
  const days = daysSince(iso);
  if (days === null) return '—';
  if (days === 0) return 'today';
  return `${days}d`;
}

export function formatCompBand(minCents: number | null, maxCents: number | null): string | null {
  if (minCents === null && maxCents === null) return null;
  const format = (cents: number): string => `$${Math.round(cents / 100_000)}k`;
  if (minCents !== null && maxCents !== null) {
    // One figure when both ends round to the same one: "$210k", not "$210k–$210k".
    const [low, high] = [format(minCents), format(maxCents)];
    return low === high ? low : `${low}–${high}`;
  }
  return format((minCents ?? maxCents)!);
}

/**
 * The day, as when.ts says it: "Today", "Friday", "12 Oct", "12 Oct 2025".
 * Through safeTimeZone, because the value comes from a free-text profile
 * field: Intl throws on a zone it does not know, and an uncaught throw in a
 * server component is a 500, not a wrong date. See lib/core/timezone.ts.
 */
export function formatDate(iso: string | null, timezone = 'UTC', now: WhenInput = Date.now()): string {
  if (!iso) return '—';
  if (!Number.isFinite(new Date(iso).getTime())) return '—';
  return whenDay(iso, { timeZone: safeTimeZone(timezone), now });
}

/**
 * The date itself, never "Today" or a weekday: "12 Oct", "12 Oct 2025". For a
 * date inside a sentence ("Rejected on 12 Oct", "last checked 12 Oct"), where
 * a relative day would read "on Today".
 */
export function formatDateInline(iso: string | null, timezone = 'UTC', now: WhenInput = Date.now()): string {
  if (!iso) return '—';
  if (!Number.isFinite(new Date(iso).getTime())) return '—';
  return whenDate(iso, { timeZone: safeTimeZone(timezone), year: 'auto', now });
}

/**
 * When a round is, saying only as much as is actually known.
 *
 * A round can be on the calendar with an hour, agreed for a day whose hour is
 * still being worked out, or agreed in principle with no date at all. Putting
 * all three through formatDateTime printed the middle one as midnight — a time
 * nobody said — and the last as an em dash that reads like missing data rather
 * than like the answer.
 */
export function formatInterviewWhen(
  iso: string | null,
  timeKnown: boolean,
  timezone = 'UTC',
  now: WhenInput = Date.now(),
): string {
  if (!iso) return 'Date to be set';
  return timeKnown ? formatDateTime(iso, timezone, now) : formatDate(iso, timezone, now);
}

/** The day and the time, with the zone it was read in: "Tomorrow, 2:30 PM EDT". */
export function formatDateTime(iso: string | null, timezone = 'UTC', now: WhenInput = Date.now()): string {
  if (!iso) return '—';
  if (!Number.isFinite(new Date(iso).getTime())) return '—';
  const timeZone = safeTimeZone(timezone);
  return `${whenDay(iso, { timeZone, now })}, ${whenTime(iso, { timeZone })} ${whenZoneName(iso, { timeZone })}`;
}

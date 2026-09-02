import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import {
  highWaterFromRejectionStage,
  requirementCoverage,
  type ApplicationSource,
  type ApplicationStatus,
  type CoverageEntry,
  type FunnelApplication,
  type RejectionStage,
  type RequirementCoverage,
} from '@/lib/jobs/pipeline';
import { safeTimeZone } from '@/lib/jobs/timezone';

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
  roleTitle: string;
  location: string | null;
  workMode: string | null;
  status: ApplicationStatus;
  source: ApplicationSource;
  attempt: number;
  excitement: number | null;
  needsReview: boolean;
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
  compMinCents: number | null;
  compMaxCents: number | null;
  /**
   * Must-have coverage from the stored requirement match, or a null rate when
   * the role has never been matched. Derived once here rather than per card,
   * for the same reason `daysSinceActivity` is.
   */
  coverage: RequirementCoverage;
}

const SELECT = `
  id, status, source, attempt, excitement, needs_review, created_by,
  submitted_at, confirmation_received_at, first_human_response_at, closed_at,
  outcome, rejection_stage, rejection_stage_override, next_action, next_action_due, created_at,
  roles!inner (
    id, title, location, work_mode, comp_min_cents, comp_max_cents, requirement_matches,
    companies!inner ( id, name, slug, logo_url )
  )
`;

type RawRow = {
  id: string;
  status: ApplicationStatus;
  source: ApplicationSource;
  attempt: number;
  excitement: number | null;
  needs_review: boolean;
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
    companies: { id: string; name: string; slug: string; logo_url: string | null };
  };
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
    .select('application_id, occurred_at')
    .eq('user_id', userId)
    .order('occurred_at', { ascending: false });

  const lastActivity = new Map<string, string>();
  for (const event of activity ?? []) {
    const id = event.application_id as string;
    if (!lastActivity.has(id)) lastActivity.set(id, event.occurred_at as string);
  }

  return rows.map((row) => ({
    applicationId: row.id,
    roleId: row.roles.id,
    companyId: row.roles.companies.id,
    companyName: row.roles.companies.name,
    companySlug: row.roles.companies.slug,
    companyLogoUrl: row.roles.companies.logo_url,
    roleTitle: row.roles.title,
    location: row.roles.location,
    workMode: row.roles.work_mode,
    status: row.status,
    source: row.source,
    attempt: row.attempt,
    excitement: row.excitement,
    needsReview: row.needs_review,
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
    compMinCents: row.roles.comp_min_cents,
    compMaxCents: row.roles.comp_max_cents,
    coverage: requirementCoverage(row.roles.requirement_matches),
  }));
}

/** Flatten to the shape lib/pipeline.ts computes from. */
export function toFunnelApplications(rows: readonly PipelineRow[]): FunnelApplication[] {
  return rows.map((row) => {
    const submittedAt = row.submittedAt ? new Date(row.submittedAt) : null;
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
      ),
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
  if (minCents !== null && maxCents !== null) return `${format(minCents)}–${format(maxCents)}`;
  return format((minCents ?? maxCents)!);
}

export function formatDate(iso: string | null, timezone = 'UTC'): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    // Through safeTimeZone, because the value comes from a free-text profile
    // field: Intl throws on a zone it does not know, and an uncaught throw in
    // a server component is a 500, not a wrong date. See lib/jobs/timezone.ts.
    timeZone: safeTimeZone(timezone),
  }).format(date);
}

export function formatDateTime(iso: string | null, timezone = 'UTC'): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: safeTimeZone(timezone),
    timeZoneName: 'short',
  }).format(date);
}

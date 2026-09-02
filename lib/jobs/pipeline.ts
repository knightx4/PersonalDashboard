/**
 * Status derivation and ALL funnel math.
 *
 * This is the analogue of Shopping Manager's money module. Every number the
 * product is judged on comes from here: it is defined once, implemented once,
 * and tested against a fixture. Nothing computes a rate inline in a component
 * — an ESLint rule blocks the shape, and the reason is that a rate with the
 * wrong denominator is indistinguishable from a rate with the right one until
 * you act on it.
 *
 * The status rules restated below are the same rules implemented in SQL by
 * public.sync_application_state(). tests/status.test.ts asserts the two agree
 * against a real database, because two implementations of one rule drift.
 */

export const APPLICATION_STATUSES = [
  'lead',
  'drafting',
  'submitted',
  'acknowledged',
  'in_process',
  'final_round',
  'offer',
  'rejected',
  'withdrawn',
  'ghosted',
  'role_closed',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_SOURCES = [
  'portal',
  'linkedin',
  'referral',
  'recruiter_inbound',
  'job_board',
  'direct_outreach',
  'other',
] as const;

export type ApplicationSource = (typeof APPLICATION_SOURCES)[number];

export const SOURCE_LABELS: Record<ApplicationSource, string> = {
  portal: 'Cold portal',
  linkedin: 'LinkedIn',
  referral: 'Referral',
  recruiter_inbound: 'Recruiter inbound',
  job_board: 'Job board',
  direct_outreach: 'Direct outreach',
  other: 'Other',
};

export const APPLICATION_EVENT_KINDS = [
  'submitted',
  'confirmation',
  'recruiter_reply',
  'screen_scheduled',
  'assessment_sent',
  'assessment_submitted',
  'interview_scheduled',
  'interview_completed',
  'offer',
  'rejection',
  'withdrawal',
  'follow_up_sent',
  'status_override',
  'note',
] as const;

export type ApplicationEventKind = (typeof APPLICATION_EVENT_KINDS)[number];

export type RejectionStage =
  | 'pre_screen'
  | 'resume_review'
  | 'recruiter_screen'
  | 'hiring_manager'
  | 'technical'
  | 'onsite'
  | 'final'
  | 'offer_stage'
  | 'unknown';

export type ApplicationOutcome =
  | 'rejected'
  | 'withdrawn'
  | 'ghosted'
  | 'offer_declined'
  | 'offer_accepted'
  | 'role_closed';

/** Forward progress only. Terminal states sit outside the ladder at -1. */
const RANK: Record<ApplicationStatus, number> = {
  lead: 0,
  drafting: 1,
  submitted: 2,
  acknowledged: 3,
  in_process: 4,
  final_round: 5,
  offer: 6,
  rejected: -1,
  withdrawn: -1,
  ghosted: -1,
  role_closed: -1,
};

export const TERMINAL_STATUSES: readonly ApplicationStatus[] = [
  'rejected',
  'withdrawn',
  'ghosted',
  'role_closed',
];

export function statusRank(status: ApplicationStatus): number {
  return RANK[status];
}

export function isTerminal(status: ApplicationStatus): boolean {
  return RANK[status] === -1;
}

/** Statuses that mean "the application reached a live human conversation". */
export const IN_PROCESS_OR_LATER: readonly ApplicationStatus[] = [
  'in_process',
  'final_round',
  'offer',
];

/**
 * Events that required a human to make a decision about you specifically.
 *
 * `confirmation` is excluded because an auto-ack from no-reply@greenhouse.io is
 * not a human response. `rejection` is excluded because bulk rejections are
 * automated too, and counting them would make the response rate look several
 * times better than it is — which is the exact failure this metric exists to
 * avoid. Both exclusions are asserted by the fixture.
 */
export const HUMAN_RESPONSE_KINDS: readonly ApplicationEventKind[] = [
  'recruiter_reply',
  'screen_scheduled',
  'assessment_sent',
  'interview_scheduled',
  'offer',
];

export const DEFAULT_GHOST_THRESHOLD_DAYS = 30;

/**
 * How long a completed, un-debriefed interview stays "write it up tonight"
 * urgent. Past that, it is just an old interview with no notes -- still
 * visible in the Past list, but no longer nagging as if it happened today.
 */
export const DEBRIEF_NUDGE_WINDOW_DAYS = 3;

/**
 * How long a cohort needs before its rates mean anything. Applications sent
 * last week have not had time to be answered; including them drags every rate
 * toward zero and makes recent effort look like failure.
 */
export const RESPONSE_WINDOW_DAYS = 21;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PipelineEvent {
  kind: ApplicationEventKind;
  occurredAt: Date;
  source: 'email' | 'manual' | 'system';
  /** Only `interview_kind` and `status` are read; the rest is display detail. */
  payload?: { interviewKind?: string | null; status?: ApplicationStatus | null } | null;
}

export interface DerivedState {
  status: ApplicationStatus;
  submittedAt: Date | null;
  confirmationReceivedAt: Date | null;
  firstHumanResponseAt: Date | null;
  closedAt: Date | null;
  outcome: ApplicationOutcome | null;
  rejectionStage: RejectionStage | null;
  lastEventAt: Date | null;
  /** Events that would have moved status backwards. Written, never applied. */
  flaggedEventIndexes: number[];
}

function interviewTarget(kind: string | null | undefined): ApplicationStatus {
  return kind === 'final' || kind === 'onsite' ? 'final_round' : 'in_process';
}

function inferRejectionStage(
  statusAtRejection: ApplicationStatus,
  lastInterviewKind: string | null,
): RejectionStage {
  switch (statusAtRejection) {
    case 'lead':
    case 'drafting':
    case 'submitted':
      return 'pre_screen';
    case 'acknowledged':
      return 'resume_review';
    case 'final_round':
      return 'final';
    case 'offer':
      return 'offer_stage';
    case 'in_process':
      switch (lastInterviewKind) {
        case 'recruiter_screen':
          return 'recruiter_screen';
        case 'hiring_manager':
          return 'hiring_manager';
        case 'technical':
        case 'case':
          return 'technical';
        case 'panel':
        case 'onsite':
          return 'onsite';
        case 'final':
          return 'final';
        default:
          return 'recruiter_screen';
      }
    default:
      return 'unknown';
  }
}

/**
 * Fold events forward into a status. The single definition of the state
 * machine on the TypeScript side.
 */
export function deriveApplicationState(
  events: readonly PipelineEvent[],
  opts: {
    manualOverride?: ApplicationStatus | null;
    /** Hand-corrected stage; wins over inference. */
    rejectionStageOverride?: RejectionStage | null;
    ghostThresholdDays?: number;
    now?: Date;
  } = {},
): DerivedState {
  const now = opts.now ?? new Date();
  const threshold = opts.ghostThresholdDays ?? DEFAULT_GHOST_THRESHOLD_DAYS;

  const ordered = [...events]
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.occurredAt.getTime() - b.event.occurredAt.getTime());

  const overrideSetAt = ordered
    .filter((e) => e.event.kind === 'status_override')
    .map((e) => e.event.occurredAt.getTime())
    .reduce<number | null>((max, t) => (max === null || t > max ? t : max), null);

  let override = opts.manualOverride ?? null;
  let status: ApplicationStatus = 'lead';
  let submittedAt: Date | null = null;
  let confirmationReceivedAt: Date | null = null;
  let firstHumanResponseAt: Date | null = null;
  let closedAt: Date | null = null;
  let outcome: ApplicationOutcome | null = null;
  let rejectionStage: RejectionStage | null = null;
  let lastEventAt: Date | null = null;
  let lastInterviewKind: string | null = null;
  const flaggedEventIndexes: number[] = [];

  const earliest = (current: Date | null, candidate: Date): Date =>
    current === null || candidate < current ? candidate : current;

  for (const { event, index } of ordered) {
    lastEventAt = event.occurredAt;

    if (
      event.source === 'email' &&
      override !== null &&
      (overrideSetAt === null || event.occurredAt.getTime() > overrideSetAt)
    ) {
      override = null;
    }

    if (HUMAN_RESPONSE_KINDS.includes(event.kind)) {
      firstHumanResponseAt = earliest(firstHumanResponseAt, event.occurredAt);
    }

    if (event.kind === 'interview_scheduled' || event.kind === 'interview_completed') {
      lastInterviewKind = event.payload?.interviewKind ?? lastInterviewKind;
    }

    if (event.kind === 'submitted') {
      submittedAt = earliest(submittedAt, event.occurredAt);
    }
    if (event.kind === 'confirmation') {
      confirmationReceivedAt = earliest(confirmationReceivedAt, event.occurredAt);
    }

    if (event.kind === 'rejection') {
      if (!isTerminal(status)) {
        rejectionStage = inferRejectionStage(status, lastInterviewKind);
        status = 'rejected';
        closedAt = event.occurredAt;
        outcome = 'rejected';
      }
      continue;
    }

    if (event.kind === 'withdrawal') {
      if (!isTerminal(status)) {
        status = 'withdrawn';
        closedAt = event.occurredAt;
        outcome = 'withdrawn';
      }
      continue;
    }

    let target: ApplicationStatus | null = null;
    switch (event.kind) {
      case 'submitted':
        target = 'submitted';
        break;
      case 'confirmation':
        target = 'acknowledged';
        break;
      case 'recruiter_reply':
      case 'screen_scheduled':
      case 'assessment_sent':
      case 'assessment_submitted':
        target = 'in_process';
        break;
      case 'interview_scheduled':
      case 'interview_completed':
        target = interviewTarget(event.payload?.interviewKind);
        break;
      case 'offer':
        target = 'offer';
        break;
      default:
        target = null;
    }

    if (target === null) continue;

    // Rule: a stray email after a rejection does not reopen the application.
    if (isTerminal(status)) {
      flaggedEventIndexes.push(index);
      continue;
    }

    if (statusRank(target) > statusRank(status)) {
      status = target;
    }
  }

  if (override !== null) {
    status = override;
    if (isTerminal(override)) {
      closedAt =
        closedAt ?? (overrideSetAt !== null ? new Date(overrideSetAt) : now);
      outcome =
        outcome ??
        (override === 'rejected'
          ? 'rejected'
          : override === 'withdrawn'
            ? 'withdrawn'
            : override === 'role_closed'
              ? 'role_closed'
              : null);
    } else {
      closedAt = null;
      outcome = null;
    }
  }

  // Ghosting is a view over silence, never a state you enter by hand.
  //
  // 'lead' and 'drafting' are excluded because they describe your own inaction,
  // not theirs. 'offer' is excluded because an outstanding offer is a decision
  // waiting on you: silence there is not the employer dropping you, and
  // sweeping it into the ghost bucket would erase the offer from the funnel.
  if (
    !isTerminal(status) &&
    status !== 'lead' &&
    status !== 'drafting' &&
    status !== 'offer' &&
    lastEventAt !== null &&
    now.getTime() - lastEventAt.getTime() > threshold * DAY_MS
  ) {
    status = 'ghosted';
    outcome = 'ghosted';
    closedAt = closedAt ?? new Date(lastEventAt.getTime() + threshold * DAY_MS);
  }

  return {
    status,
    submittedAt,
    confirmationReceivedAt,
    firstHumanResponseAt,
    closedAt,
    outcome,
    rejectionStage: opts.rejectionStageOverride ?? rejectionStage,
    lastEventAt,
    flaggedEventIndexes,
  };
}

/* -------------------------------------------------------------------------
 * Funnel math
 * ---------------------------------------------------------------------- */

/** One application, flattened to exactly what the funnel needs. */
export interface FunnelApplication {
  id: string;
  source: ApplicationSource;
  status: ApplicationStatus;
  submittedAt: Date | null;
  confirmationReceivedAt: Date | null;
  firstHumanResponseAt: Date | null;
  outcome: ApplicationOutcome | null;
  rejectionStage: RejectionStage | null;
  /** Highest status ever reached, so a rejection does not erase the progress. */
  highWaterStatus: ApplicationStatus;
}

export interface Period {
  from: Date;
  /** Exclusive. */
  to: Date;
  label: string;
}

/** Inclusive-from, exclusive-to, so month boundaries never double count. */
export function inPeriod(date: Date | null, period: Period): boolean {
  if (!date) return false;
  return date >= period.from && date < period.to;
}

/**
 * The highest rung an application ever reached.
 *
 * Needed because status is current, not maximal: an application rejected after
 * an onsite has status 'rejected', and counting only current status would
 * report zero onsites. The derivation records the rejection stage, which is
 * what lets this be reconstructed without replaying every event.
 */
export function highWaterFromRejectionStage(
  status: ApplicationStatus,
  rejectionStage: RejectionStage | null,
  submittedAt: Date | null,
  confirmationReceivedAt: Date | null,
  firstHumanResponseAt: Date | null,
): ApplicationStatus {
  if (!isTerminal(status)) return status;
  if (firstHumanResponseAt) {
    switch (rejectionStage) {
      case 'final':
      case 'offer_stage':
        return 'final_round';
      default:
        return 'in_process';
    }
  }
  if (confirmationReceivedAt) return 'acknowledged';
  if (submittedAt) return 'submitted';
  return 'lead';
}

export function reached(app: FunnelApplication, stage: ApplicationStatus): boolean {
  return statusRank(app.highWaterStatus) >= statusRank(stage);
}

/**
 * How many sent applications ever reached a rung.
 *
 * Note this is not the same as counting confirmations for the 'acknowledged'
 * rung: a recruiter-inbound pursuit that went straight to a human never gets an
 * auto-ack but has plainly cleared that rung, and counting confirmations there
 * would report it as a drop-off that never happened.
 */
export function countReaching(
  applications: readonly FunnelApplication[],
  stage: ApplicationStatus,
): number {
  return applications.filter((a) => a.submittedAt !== null && reached(a, stage)).length;
}

export interface FunnelMetrics {
  applicationsSent: number;
  confirmations: number;
  responses: number;
  screens: number;
  finalRounds: number;
  offers: number;
  ghosted: number;
  rejected: number;
  confirmationRate: number | null;
  responseRate: number | null;
  screenRate: number | null;
  ghostRate: number | null;
  offerRate: number | null;
  medianDaysToResponse: number | null;
  /** True when this cohort is younger than the response window. */
  tooEarly: boolean;
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return numerator / denominator;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / DAY_MS;
}

/**
 * Metrics for one cohort of applications.
 *
 * Cohorted by *submission* date, always. Applications sent in June are the June
 * cohort forever and their response rate updates as responses arrive. Counting
 * responses in the month they land produces a number that moves for reasons
 * unrelated to anything you did that month.
 */
export function funnelMetrics(
  applications: readonly FunnelApplication[],
  opts: { now?: Date; cohortEnd?: Date | null } = {},
): FunnelMetrics {
  const now = opts.now ?? new Date();
  const sent = applications.filter((a) => a.submittedAt !== null);

  const responseDays = sent
    .filter((a) => a.firstHumanResponseAt && a.submittedAt)
    .map((a) => daysBetween(a.submittedAt!, a.firstHumanResponseAt!));

  const confirmations = sent.filter((a) => a.confirmationReceivedAt !== null).length;
  const responses = sent.filter((a) => a.firstHumanResponseAt !== null).length;
  const screens = sent.filter((a) => reached(a, 'in_process')).length;
  const finalRounds = sent.filter((a) => reached(a, 'final_round')).length;
  const offers = sent.filter((a) => reached(a, 'offer')).length;
  const ghosted = sent.filter((a) => a.outcome === 'ghosted').length;
  const rejected = sent.filter((a) => a.outcome === 'rejected').length;

  // A cohort whose last day is more recent than the response window has not had
  // time to answer. Its rates are reported separately as "too early to tell".
  const youngestBoundary = opts.cohortEnd ?? null;
  const tooEarly =
    youngestBoundary !== null &&
    daysBetween(youngestBoundary, now) < RESPONSE_WINDOW_DAYS;

  return {
    applicationsSent: sent.length,
    confirmations,
    responses,
    screens,
    finalRounds,
    offers,
    ghosted,
    rejected,
    confirmationRate: rate(confirmations, sent.length),
    responseRate: rate(responses, sent.length),
    screenRate: rate(screens, sent.length),
    ghostRate: rate(ghosted, sent.length),
    offerRate: rate(offers, sent.length),
    medianDaysToResponse: median(responseDays),
    tooEarly,
  };
}

/**
 * The advance rate from one stage to the next: of everything that reached
 * `stage`, what share reached the rung above it.
 */
export function advanceRate(
  applications: readonly FunnelApplication[],
  stage: ApplicationStatus,
): number | null {
  const ladder: ApplicationStatus[] = [
    'submitted',
    'acknowledged',
    'in_process',
    'final_round',
    'offer',
  ];
  const index = ladder.indexOf(stage);
  if (index === -1 || index === ladder.length - 1) return null;
  const next = ladder[index + 1];
  const atStage = applications.filter((a) => reached(a, stage));
  return rate(atStage.filter((a) => reached(a, next)).length, atStage.length);
}

/**
 * Every rate, grouped by source.
 *
 * The whole diagnostic value is in the comparison between channels — a single
 * blended number hides that referrals convert ten times better than cold
 * portals — so the analytics page never renders the blended figure alone.
 */
export function metricsBySource(
  applications: readonly FunnelApplication[],
  opts: { now?: Date; cohortEnd?: Date | null } = {},
): Array<{ source: ApplicationSource; metrics: FunnelMetrics }> {
  return APPLICATION_SOURCES.map((source) => ({
    source,
    metrics: funnelMetrics(
      applications.filter((a) => a.source === source),
      opts,
    ),
  })).filter((entry) => entry.metrics.applicationsSent > 0);
}

/** Monthly cohorts in the user's timezone-free local terms, newest last. */
export function monthlyCohorts(
  applications: readonly FunnelApplication[],
  opts: { now?: Date } = {},
): Array<{ period: Period; metrics: FunnelMetrics }> {
  const now = opts.now ?? new Date();
  const keys = new Set<string>();
  for (const app of applications) {
    if (!app.submittedAt) continue;
    keys.add(app.submittedAt.toISOString().slice(0, 7));
  }

  return [...keys]
    .sort()
    .map((key) => {
      const [year, month] = key.split('-').map(Number);
      const from = new Date(Date.UTC(year, month - 1, 1));
      const to = new Date(Date.UTC(month === 12 ? year + 1 : year, month % 12, 1));
      const period: Period = { from, to, label: key };
      return {
        period,
        metrics: funnelMetrics(
          applications.filter((a) => inPeriod(a.submittedAt, period)),
          { now, cohortEnd: to > now ? now : to },
        ),
      };
    });
}

/** Rejection stage distribution — the diagnosis, not just the count. */
export function rejectionStageDistribution(
  applications: readonly FunnelApplication[],
): Array<{ stage: RejectionStage; count: number }> {
  const stages: RejectionStage[] = [
    'pre_screen',
    'resume_review',
    'recruiter_screen',
    'hiring_manager',
    'technical',
    'onsite',
    'final',
    'offer_stage',
    'unknown',
  ];
  const counts = new Map<RejectionStage, number>();
  for (const app of applications) {
    if (app.outcome !== 'rejected' || !app.rejectionStage) continue;
    counts.set(app.rejectionStage, (counts.get(app.rejectionStage) ?? 0) + 1);
  }
  return stages
    .map((stage) => ({ stage, count: counts.get(stage) ?? 0 }))
    .filter((entry) => entry.count > 0);
}

/** Percentage for display. Null rates render as "—", never as 0%. */
export function formatRate(value: number | null, digits = 0): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDays(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} ${rounded === 1 ? 'day' : 'days'}`;
}

// ---------------------------------------------------------------------------
// Requirement coverage
//
// The map on the role page tells you what to fix; this number is what makes
// you look. It is the same job /jobs/today does for time and the review queue
// does for trust: reduce a screenful to the one figure that changes what you
// do next, and put it where the decision is made.
//
// Must-haves only. A nice-to-have you cannot claim costs nothing, and folding
// it into the count is how "4 of 6" becomes "9 of 21" and stops meaning
// anything. Responsibilities describe the job, not the bar to clear.
//
// Arithmetic over a stored match, no model call. It lives here rather than in
// a component for the same reason every other derived number does: a count
// with the wrong denominator is indistinguishable from a right one until you
// act on it, and three screens computing it inline would disagree by next
// month.
// ---------------------------------------------------------------------------

/** One line of the stored map, as much of it as the count needs. */
export interface CoverageEntry {
  kind: 'must_have' | 'nice_to_have' | 'responsibility';
  verdict: 'strong' | 'partial' | 'gap';
}

export interface RequirementCoverage {
  /** Must-haves answered strongly. */
  covered: number;
  /** Must-haves in total. Zero means the number is not worth showing. */
  total: number;
  /** Must-haves that are outright gaps — what you would have to talk around. */
  gaps: number;
  /**
   * Covered over total, or null when there are no must-haves. Null renders as
   * "—", never as 0%, the same rule the funnel rates follow.
   */
  rate: number | null;
}

/**
 * A partial counts as half.
 *
 * Not because half is precise, but because the two alternatives are both
 * wrong in a way that matters. Counting it as covered lets a row of "adjacent,
 * but less depth" read as a role you can claim, which is the flattery this
 * layer exists to remove. Counting it as a gap makes a genuinely close fit
 * look like a wall and sends you past roles worth an hour. Half keeps a
 * mixed map ranked between a strong one and a hollow one, which is all the
 * number is for.
 */
const PARTIAL_WEIGHT = 0.5;

export function requirementCoverage(
  matches: readonly CoverageEntry[] | null | undefined,
): RequirementCoverage {
  const musts = (matches ?? []).filter((match) => match.kind === 'must_have');
  if (musts.length === 0) return { covered: 0, total: 0, gaps: 0, rate: null };

  const strong = musts.filter((match) => match.verdict === 'strong').length;
  const partial = musts.filter((match) => match.verdict === 'partial').length;

  return {
    covered: strong,
    total: musts.length,
    gaps: musts.filter((match) => match.verdict === 'gap').length,
    rate: (strong + partial * PARTIAL_WEIGHT) / musts.length,
  };
}

/** "4 of 6 must-haves", or null when there is nothing worth saying. */
export function formatCoverage(coverage: RequirementCoverage): string | null {
  if (coverage.total === 0) return null;
  return `${coverage.covered} of ${coverage.total} must-have${coverage.total === 1 ? '' : 's'}`;
}

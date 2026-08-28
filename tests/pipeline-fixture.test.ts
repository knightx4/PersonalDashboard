/**
 * The funnel fixture.
 *
 * Twelve applications, three sources, three months, containing every case that
 * has ever made a job-search funnel lie:
 *
 *   - an automated follow-up that must NOT count as a human response
 *   - an application that goes quiet and crosses the ghost threshold mid-fixture
 *   - a re-application to a role already rejected once
 *   - a rejection after a final round, next to one at resume review
 *
 * Every metric is asserted against a hand-computed value. This single test
 * protects every number the product is judged on, which is why it exists before
 * any screen reads those numbers.
 */
import { describe, expect, it } from 'vitest';
import {
  advanceRate,
  countReaching,
  deriveApplicationState,
  funnelMetrics,
  highWaterFromRejectionStage,
  metricsBySource,
  monthlyCohorts,
  rejectionStageDistribution,
  type ApplicationSource,
  type FunnelApplication,
  type PipelineEvent,
} from '@/lib/jobs/pipeline';

const NOW = new Date('2026-04-15T12:00:00Z');

function d(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}

type Spec = {
  id: string;
  source: ApplicationSource;
  events: PipelineEvent[];
};

/** Every spec is written as events, so the fixture exercises the derivation too. */
const SPECS: Spec[] = [
  // --- January: the oldest cohort, fully resolved -------------------------
  {
    // Cold portal, auto-ack, then silence: rejected at resume review.
    id: 'jan-portal-rejected-early',
    source: 'portal',
    events: [
      { kind: 'submitted', occurredAt: d('2026-01-06'), source: 'manual' },
      { kind: 'confirmation', occurredAt: d('2026-01-06'), source: 'email' },
      { kind: 'rejection', occurredAt: d('2026-01-20'), source: 'email' },
    ],
  },
  {
    // Cold portal, auto-ack, then an automated "we are still reviewing" nudge.
    // follow_up_sent is not a human response and must not move any rate.
    id: 'jan-portal-automated-followup',
    source: 'portal',
    events: [
      { kind: 'submitted', occurredAt: d('2026-01-08'), source: 'manual' },
      { kind: 'confirmation', occurredAt: d('2026-01-08'), source: 'email' },
      { kind: 'follow_up_sent', occurredAt: d('2026-01-15'), source: 'email' },
      { kind: 'rejection', occurredAt: d('2026-01-29'), source: 'email' },
    ],
  },
  {
    // Referral, all the way to an onsite, rejected at the final round.
    id: 'jan-referral-final-rejection',
    source: 'referral',
    events: [
      { kind: 'submitted', occurredAt: d('2026-01-09'), source: 'manual' },
      { kind: 'confirmation', occurredAt: d('2026-01-09'), source: 'email' },
      { kind: 'recruiter_reply', occurredAt: d('2026-01-12'), source: 'email' },
      {
        kind: 'interview_scheduled',
        occurredAt: d('2026-01-16'),
        source: 'email',
        payload: { interviewKind: 'recruiter_screen' },
      },
      {
        kind: 'interview_scheduled',
        occurredAt: d('2026-01-26'),
        source: 'email',
        payload: { interviewKind: 'onsite' },
      },
      { kind: 'rejection', occurredAt: d('2026-02-04'), source: 'email' },
    ],
  },
  {
    // Recruiter inbound that converts to an offer.
    id: 'jan-inbound-offer',
    source: 'recruiter_inbound',
    events: [
      { kind: 'submitted', occurredAt: d('2026-01-12'), source: 'manual' },
      { kind: 'recruiter_reply', occurredAt: d('2026-01-14'), source: 'email' },
      {
        kind: 'interview_scheduled',
        occurredAt: d('2026-01-20'),
        source: 'email',
        payload: { interviewKind: 'hiring_manager' },
      },
      {
        kind: 'interview_scheduled',
        occurredAt: d('2026-02-02'),
        source: 'email',
        payload: { interviewKind: 'final' },
      },
      { kind: 'offer', occurredAt: d('2026-02-10'), source: 'email' },
    ],
  },

  // --- February -----------------------------------------------------------
  {
    // Applied, acknowledged, then nothing at all. Crosses the 30-day ghost
    // threshold well before NOW, and must be counted as ghosted without anyone
    // touching it.
    id: 'feb-portal-ghosted',
    source: 'portal',
    events: [
      { kind: 'submitted', occurredAt: d('2026-02-03'), source: 'manual' },
      { kind: 'confirmation', occurredAt: d('2026-02-03'), source: 'email' },
    ],
  },
  {
    id: 'feb-portal-rejected-prescreen',
    source: 'portal',
    events: [
      { kind: 'submitted', occurredAt: d('2026-02-05'), source: 'manual' },
      { kind: 'rejection', occurredAt: d('2026-02-09'), source: 'email' },
    ],
  },
  {
    id: 'feb-referral-in-process',
    source: 'referral',
    events: [
      { kind: 'submitted', occurredAt: d('2026-02-11'), source: 'manual' },
      { kind: 'confirmation', occurredAt: d('2026-02-11'), source: 'email' },
      { kind: 'recruiter_reply', occurredAt: d('2026-02-13'), source: 'email' },
      {
        kind: 'interview_scheduled',
        occurredAt: d('2026-04-08'),
        source: 'email',
        payload: { interviewKind: 'technical' },
      },
    ],
  },
  {
    // The re-application: same role as jan-portal-rejected-early, second
    // attempt. It is its own row in its own cohort, and the first attempt's
    // rejection stage stays untouched.
    id: 'feb-portal-reapplication',
    source: 'portal',
    events: [
      { kind: 'submitted', occurredAt: d('2026-02-20'), source: 'manual' },
      { kind: 'confirmation', occurredAt: d('2026-02-20'), source: 'email' },
      { kind: 'recruiter_reply', occurredAt: d('2026-02-27'), source: 'email' },
      { kind: 'rejection', occurredAt: d('2026-03-06'), source: 'email' },
    ],
  },

  // --- March --------------------------------------------------------------
  {
    id: 'mar-inbound-screen',
    source: 'recruiter_inbound',
    events: [
      { kind: 'submitted', occurredAt: d('2026-03-04'), source: 'manual' },
      { kind: 'recruiter_reply', occurredAt: d('2026-03-06'), source: 'email' },
      {
        kind: 'interview_scheduled',
        occurredAt: d('2026-03-30'),
        source: 'email',
        payload: { interviewKind: 'recruiter_screen' },
      },
    ],
  },
  {
    id: 'mar-portal-acknowledged',
    source: 'portal',
    events: [
      { kind: 'submitted', occurredAt: d('2026-03-18'), source: 'manual' },
      { kind: 'confirmation', occurredAt: d('2026-03-18'), source: 'email' },
      // A stray "we are still considering candidates" blast on 1 April keeps
      // this row alive; without it the ghost threshold would fire.
      { kind: 'follow_up_sent', occurredAt: d('2026-04-01'), source: 'email' },
    ],
  },
  {
    id: 'mar-referral-rejected-technical',
    source: 'referral',
    events: [
      { kind: 'submitted', occurredAt: d('2026-03-20'), source: 'manual' },
      { kind: 'confirmation', occurredAt: d('2026-03-20'), source: 'email' },
      { kind: 'recruiter_reply', occurredAt: d('2026-03-23'), source: 'email' },
      {
        kind: 'interview_completed',
        occurredAt: d('2026-03-30'),
        source: 'manual',
        payload: { interviewKind: 'technical' },
      },
      { kind: 'rejection', occurredAt: d('2026-04-03'), source: 'email' },
      // The classic trap: a recruiter follow-up AFTER the rejection. It must
      // not reopen the application.
      { kind: 'recruiter_reply', occurredAt: d('2026-04-09'), source: 'email' },
    ],
  },
  {
    // Submitted five days before NOW — inside the response window, so the
    // April cohort is "too early to tell" rather than a 0% response rate.
    id: 'apr-portal-fresh',
    source: 'portal',
    events: [{ kind: 'submitted', occurredAt: d('2026-04-10'), source: 'manual' }],
  },
];

function build(spec: Spec): FunnelApplication & { flagged: number[] } {
  const state = deriveApplicationState(spec.events, { now: NOW, ghostThresholdDays: 30 });
  return {
    id: spec.id,
    source: spec.source,
    status: state.status,
    submittedAt: state.submittedAt,
    confirmationReceivedAt: state.confirmationReceivedAt,
    firstHumanResponseAt: state.firstHumanResponseAt,
    outcome: state.outcome,
    rejectionStage: state.rejectionStage,
    highWaterStatus: highWaterFromRejectionStage(
      state.status,
      state.rejectionStage,
      state.submittedAt,
      state.confirmationReceivedAt,
      state.firstHumanResponseAt,
    ),
    flagged: state.flaggedEventIndexes,
  };
}

const APPS = SPECS.map(build);
const byId = (id: string) => APPS.find((a) => a.id === id)!;

describe('derivation', () => {
  it('derives a terminal rejection and its stage from the status it was in', () => {
    expect(byId('jan-portal-rejected-early').status).toBe('rejected');
    expect(byId('jan-portal-rejected-early').rejectionStage).toBe('resume_review');
    expect(byId('feb-portal-rejected-prescreen').rejectionStage).toBe('pre_screen');
    expect(byId('jan-referral-final-rejection').rejectionStage).toBe('final');
    expect(byId('mar-referral-rejected-technical').rejectionStage).toBe('technical');
  });

  it('never counts an automated confirmation as a human response', () => {
    const app = byId('jan-portal-automated-followup');
    expect(app.confirmationReceivedAt).not.toBeNull();
    expect(app.firstHumanResponseAt).toBeNull();
  });

  it('does not let a follow-up blast count as a human response either', () => {
    expect(byId('mar-portal-acknowledged').firstHumanResponseAt).toBeNull();
    expect(byId('mar-portal-acknowledged').status).toBe('acknowledged');
  });

  it('ghosts a quiet application without anybody touching it', () => {
    const app = byId('feb-portal-ghosted');
    expect(app.status).toBe('ghosted');
    expect(app.outcome).toBe('ghosted');
  });

  it('does not reopen a rejected application when later mail arrives', () => {
    const app = byId('mar-referral-rejected-technical');
    expect(app.status).toBe('rejected');
    // The post-rejection recruiter_reply is written, flagged, and ignored.
    expect(app.flagged).toHaveLength(1);
  });

  it('takes the earliest human response, not the latest', () => {
    expect(byId('jan-referral-final-rejection').firstHumanResponseAt).toEqual(
      d('2026-01-12'),
    );
  });

  it('promotes to final_round only for onsite and final interviews', () => {
    expect(byId('jan-inbound-offer').status).toBe('offer');
    expect(byId('mar-inbound-screen').status).toBe('in_process');
  });

  it('keeps the first attempt untouched when a role is re-applied to', () => {
    expect(byId('jan-portal-rejected-early').rejectionStage).toBe('resume_review');
    expect(byId('feb-portal-reapplication').rejectionStage).toBe('recruiter_screen');
  });
});

describe('overall funnel', () => {
  const metrics = funnelMetrics(APPS, { now: NOW });

  it('counts every application as sent', () => {
    expect(metrics.applicationsSent).toBe(12);
  });

  it('counts confirmations, hand-checked', () => {
    // Every spec with a `confirmation` event: jan-portal-rejected-early,
    // jan-portal-automated-followup, jan-referral-final-rejection,
    // feb-portal-ghosted, feb-referral-in-process, feb-portal-reapplication,
    // mar-portal-acknowledged, mar-referral-rejected-technical = 8.
    expect(metrics.confirmations).toBe(8);
    expect(metrics.confirmationRate).toBeCloseTo(8 / 12, 10);
  });

  it('counts human responses, excluding both automated classes', () => {
    // recruiter_reply or interview/offer events, so:
    // jan-referral-final-rejection, jan-inbound-offer, feb-referral-in-process,
    // feb-portal-reapplication, mar-inbound-screen,
    // mar-referral-rejected-technical = 6.
    expect(metrics.responses).toBe(6);
    expect(metrics.responseRate).toBeCloseTo(0.5, 10);
  });

  it('counts everything that reached a live conversation', () => {
    expect(metrics.screens).toBe(6);
    expect(metrics.screenRate).toBeCloseTo(0.5, 10);
  });

  it('counts final rounds and offers', () => {
    // jan-referral-final-rejection (rejected at final) and jan-inbound-offer.
    expect(metrics.finalRounds).toBe(2);
    expect(metrics.offers).toBe(1);
    expect(metrics.offerRate).toBeCloseTo(1 / 12, 10);
  });

  it('counts ghosts and rejections', () => {
    expect(metrics.ghosted).toBe(1);
    expect(metrics.ghostRate).toBeCloseTo(1 / 12, 10);
    expect(metrics.rejected).toBe(6);
  });

  it('reports the median days to first human response', () => {
    // Response lags, in days:
    //   jan-referral-final-rejection  06 Jan -> ... submitted 09 Jan, reply 12 Jan = 3
    //   jan-inbound-offer             12 Jan -> 14 Jan = 2
    //   feb-referral-in-process       11 Feb -> 13 Feb = 2
    //   feb-portal-reapplication      20 Feb -> 27 Feb = 7
    //   mar-inbound-screen            04 Mar -> 06 Mar = 2
    //   mar-referral-rejected-tech    20 Mar -> 23 Mar = 3
    // sorted: 2,2,2,3,3,7 -> median = (2+3)/2 = 2.5
    expect(metrics.medianDaysToResponse).toBeCloseTo(2.5, 10);
  });
});

describe('by source', () => {
  const bySource = metricsBySource(APPS, { now: NOW });
  const find = (source: ApplicationSource) => bySource.find((s) => s.source === source)!;

  it('splits the funnel into the channels that actually differ', () => {
    expect(find('portal').metrics.applicationsSent).toBe(7);
    expect(find('referral').metrics.applicationsSent).toBe(3);
    expect(find('recruiter_inbound').metrics.applicationsSent).toBe(2);
    expect(bySource.map((s) => s.source).sort()).toEqual([
      'portal',
      'recruiter_inbound',
      'referral',
    ]);
  });

  it('shows the comparison a blended number would hide', () => {
    // Cold portal: 1 of 7 ever reached a human. Referral: 3 of 3.
    expect(find('portal').metrics.responseRate).toBeCloseTo(1 / 7, 10);
    expect(find('referral').metrics.responseRate).toBeCloseTo(1, 10);
    expect(find('recruiter_inbound').metrics.responseRate).toBeCloseTo(1, 10);
  });

  it('drops sources with nothing sent rather than rendering 0%', () => {
    expect(bySource.some((s) => s.source === 'linkedin')).toBe(false);
  });
});

describe('cohorts', () => {
  const cohorts = monthlyCohorts(APPS, { now: NOW });

  it('cohorts by submission month, not by outcome month', () => {
    expect(cohorts.map((c) => c.period.label)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
    ]);
    expect(cohorts[0].metrics.applicationsSent).toBe(4);
    expect(cohorts[1].metrics.applicationsSent).toBe(4);
    expect(cohorts[2].metrics.applicationsSent).toBe(3);
    expect(cohorts[3].metrics.applicationsSent).toBe(1);
  });

  it('keeps the January offer in the January cohort even though it landed in February', () => {
    expect(cohorts[0].metrics.offers).toBe(1);
    expect(cohorts[1].metrics.offers).toBe(0);
  });

  it('labels immature cohorts too early to tell rather than reporting 0%', () => {
    // A cohort is immature until its LAST day is older than the response
    // window: March's newest applications are only a fortnight old on 15 April,
    // so reporting March's response rate next to January's would compare a
    // finished month against an unfinished one.
    expect(cohorts[3].metrics.tooEarly).toBe(true);
    expect(cohorts[2].metrics.tooEarly).toBe(true);
    expect(cohorts[1].metrics.tooEarly).toBe(false);
    expect(cohorts[0].metrics.tooEarly).toBe(false);
  });
});

describe('stage advance rates and rejection diagnosis', () => {
  it('counts everything that ever reached a rung, not just what sits there now', () => {
    expect(countReaching(APPS, 'submitted')).toBe(12);
    // Ten cleared the acknowledgement rung: the eight with a confirmation email
    // plus the two recruiter-inbound pursuits that went straight to a human.
    expect(countReaching(APPS, 'acknowledged')).toBe(10);
    expect(countReaching(APPS, 'in_process')).toBe(6);
    expect(countReaching(APPS, 'final_round')).toBe(2);
    expect(countReaching(APPS, 'offer')).toBe(1);
  });

  it('computes advance rate stage by stage', () => {
    // 12 submitted; 10 got past the acknowledgement rung -- the 8 with a
    // confirmation email, plus the two recruiter-inbound pursuits that went
    // straight to a human without any auto-ack at all.
    expect(advanceRate(APPS, 'submitted')).toBeCloseTo(10 / 12, 10);
    // Of the 2 that reached final_round, 1 reached offer.
    expect(advanceRate(APPS, 'final_round')).toBeCloseTo(0.5, 10);
    expect(advanceRate(APPS, 'offer')).toBeNull();
  });

  it('separates rejection at resume review from rejection after a final round', () => {
    expect(rejectionStageDistribution(APPS)).toEqual([
      { stage: 'pre_screen', count: 1 },
      { stage: 'resume_review', count: 2 },
      { stage: 'recruiter_screen', count: 1 },
      { stage: 'technical', count: 1 },
      { stage: 'final', count: 1 },
    ]);
  });
});

import { AnalyticsView } from '@/app/jobs/(app)/analytics/view';
import type {
  ApplicationOutcome,
  ApplicationSource,
  ApplicationStatus,
  FunnelApplication,
  RejectionStage,
} from '@/lib/jobs/pipeline';

/**
 * The analytics page with three channels (plan #1595): a large cold-portal
 * group in the shape the live data has, a mid-sized LinkedIn one, and a
 * referral group too small to compare, so the marked row is drawn too.
 */

const NOW = new Date('2026-10-07T12:00:00Z');

type Shape = {
  count: number;
  status: ApplicationStatus;
  highWater: ApplicationStatus;
  outcome?: ApplicationOutcome;
  rejectionStage?: RejectionStage;
  acked?: boolean;
  human?: boolean;
  interviewed?: boolean;
};

const SHAPES: Record<ApplicationSource, Shape[]> = {
  portal: [
    { count: 96, status: 'ghosted', highWater: 'acknowledged', outcome: 'ghosted', acked: true },
    { count: 30, status: 'ghosted', highWater: 'submitted', outcome: 'ghosted' },
    { count: 52, status: 'rejected', highWater: 'acknowledged', outcome: 'rejected', rejectionStage: 'resume_review', acked: true },
    { count: 9, status: 'rejected', highWater: 'submitted', outcome: 'rejected', rejectionStage: 'pre_screen' },
    { count: 7, status: 'rejected', highWater: 'in_process', outcome: 'rejected', rejectionStage: 'recruiter_screen', acked: true, human: true, interviewed: true },
    { count: 3, status: 'rejected', highWater: 'final_round', outcome: 'rejected', rejectionStage: 'final', acked: true, human: true, interviewed: true },
    { count: 8, status: 'ghosted', highWater: 'in_process', outcome: 'ghosted', acked: true, human: true, interviewed: true },
    { count: 2, status: 'ghosted', highWater: 'final_round', outcome: 'ghosted', acked: true, human: true, interviewed: true },
    { count: 11, status: 'acknowledged', highWater: 'acknowledged', acked: true },
    { count: 2, status: 'in_process', highWater: 'in_process', acked: true, human: true, interviewed: true },
  ],
  linkedin: [
    { count: 9, status: 'ghosted', highWater: 'acknowledged', outcome: 'ghosted', acked: true },
    { count: 6, status: 'rejected', highWater: 'acknowledged', outcome: 'rejected', rejectionStage: 'resume_review', acked: true },
    { count: 2, status: 'rejected', highWater: 'in_process', outcome: 'rejected', rejectionStage: 'hiring_manager', acked: true, human: true, interviewed: true },
    { count: 1, status: 'ghosted', highWater: 'in_process', outcome: 'ghosted', acked: true, human: true, interviewed: true },
    { count: 1, status: 'final_round', highWater: 'final_round', acked: true, human: true, interviewed: true },
  ],
  referral: [
    { count: 2, status: 'rejected', highWater: 'in_process', outcome: 'rejected', rejectionStage: 'technical', human: true, interviewed: true },
    { count: 1, status: 'offer', highWater: 'offer', human: true, interviewed: true },
    { count: 1, status: 'ghosted', highWater: 'submitted', outcome: 'ghosted' },
  ],
  recruiter_inbound: [],
  job_board: [],
  direct_outreach: [],
  other: [],
};

function fixtures(): FunnelApplication[] {
  const apps: FunnelApplication[] = [];
  let n = 0;
  for (const [source, shapes] of Object.entries(SHAPES) as Array<[ApplicationSource, Shape[]]>) {
    for (const shape of shapes) {
      for (let i = 0; i < shape.count; i += 1) {
        n += 1;
        // Spread over May to September, a day apart, so every month has a cohort.
        const sent = new Date(Date.UTC(2026, 4, 1 + ((n * 7) % 150)));
        apps.push({
          id: `app-${n}`,
          source,
          status: shape.status,
          submittedAt: sent,
          confirmationReceivedAt: shape.acked ? sent : null,
          firstHumanResponseAt: shape.human ? new Date(sent.getTime() + 6 * 86_400_000) : null,
          outcome: shape.outcome ?? null,
          rejectionStage: shape.rejectionStage ?? null,
          highWaterStatus: shape.highWater,
          interviewed: shape.interviewed ?? false,
        });
      }
    }
  }
  return apps;
}

export function JobsInsightsSurface() {
  return <AnalyticsView applications={fixtures()} now={NOW} />;
}

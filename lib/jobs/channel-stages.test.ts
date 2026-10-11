import { describe, expect, it } from 'vitest';
import {
  CHANNEL_MIN_SENT,
  channelStages,
  rejectionsByChannel,
  type ApplicationSource,
  type ApplicationStatus,
  type FunnelApplication,
} from './pipeline';

let n = 0;
function app(
  source: ApplicationSource,
  highWaterStatus: ApplicationStatus,
  extra: Partial<FunnelApplication> = {},
): FunnelApplication {
  n += 1;
  return {
    id: `a${n}`,
    source,
    status: highWaterStatus,
    submittedAt: new Date('2026-06-01T12:00:00Z'),
    confirmationReceivedAt: null,
    firstHumanResponseAt: null,
    outcome: null,
    rejectionStage: null,
    highWaterStatus,
    ...extra,
  };
}

const replied = { firstHumanResponseAt: new Date('2026-06-08T12:00:00Z') };
const ghosted = { status: 'ghosted' as const, outcome: 'ghosted' as const };

describe('channelStages', () => {
  const apps = [
    app('portal', 'submitted', ghosted),
    app('portal', 'acknowledged', ghosted),
    app('portal', 'acknowledged'),
    app('portal', 'in_process', { ...ghosted, ...replied, interviewed: true }),
    app('portal', 'final_round', { status: 'rejected', outcome: 'rejected', ...replied, interviewed: true }),
    // Replied but never interviewed, then silence: neither outcome.
    app('portal', 'in_process', { ...ghosted, ...replied }),
    app('referral', 'offer', { ...replied, interviewed: true }),
    // A lead never sent is not counted at all.
    app('linkedin', 'lead', { submittedAt: null }),
  ];
  const result = channelStages(apps);

  it('lists only channels with something sent, in source order', () => {
    expect(result.map((c) => c.source)).toEqual(['portal', 'referral']);
  });

  it('counts each rung reached and the share that moved on from the one below', () => {
    const portal = result[0];
    expect(portal.sent).toBe(6);
    expect(portal.stages.map((s) => s.count)).toEqual([6, 5, 3, 1, 0]);
    expect(portal.stages[0].movedOn).toBeNull();
    expect(portal.stages[1].movedOn).toBeCloseTo(5 / 6);
    expect(portal.stages[2].movedOn).toBeCloseTo(3 / 5);
    expect(portal.stages[3].movedOn).toBeCloseTo(1 / 3);
    expect(portal.stages[4].movedOn).toBe(0);
  });

  it('keeps going quiet after an interview apart from no answer', () => {
    expect(result[0].quietAfterInterview).toBe(1);
    expect(result[0].noAnswer).toBe(2);
  });

  it('marks a channel below the minimum as too few to compare', () => {
    expect(result.every((c) => !c.enough)).toBe(true);
    const many = Array.from({ length: CHANNEL_MIN_SENT }, () => app('job_board', 'submitted'));
    expect(channelStages(many)[0].enough).toBe(true);
  });

  it('gives a null share, not zero, after a rung nobody reached', () => {
    expect(channelStages([app('other', 'submitted')])[0].stages[3].movedOn).toBeNull();
  });
});

describe('rejectionsByChannel', () => {
  it('splits rejection stages by channel and leaves out channels with none', () => {
    const result = rejectionsByChannel([
      app('portal', 'acknowledged', { status: 'rejected', outcome: 'rejected', rejectionStage: 'resume_review' }),
      app('portal', 'acknowledged', { status: 'rejected', outcome: 'rejected', rejectionStage: 'resume_review' }),
      app('referral', 'final_round', { status: 'rejected', outcome: 'rejected', rejectionStage: 'final' }),
      app('linkedin', 'submitted', ghosted),
    ]);
    expect(result).toEqual([
      { source: 'portal', total: 2, stages: [{ stage: 'resume_review', count: 2 }] },
      { source: 'referral', total: 1, stages: [{ stage: 'final', count: 1 }] },
    ]);
  });
});

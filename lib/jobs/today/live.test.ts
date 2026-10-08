import { describe, expect, it } from 'vitest';
import type { PipelineRow } from '@/lib/jobs/applications/load';
import type { ApplicationEventKind, ApplicationStatus } from '@/lib/jobs/pipeline';
import { liveByMove } from './live';

function row(
  id: string,
  status: ApplicationStatus,
  lastTurnEvent: ApplicationEventKind | null = null,
  daysSinceActivity: number | null = 1,
): PipelineRow {
  return {
    applicationId: id,
    roleId: `role-${id}`,
    companyName: `Company ${id}`,
    roleTitle: 'Engineer',
    status,
    lastTurnEvent,
    daysSinceActivity,
  } as PipelineRow;
}

describe('liveByMove', () => {
  it('splits the live applications by whose move it is, closed ones left out', () => {
    const live = liveByMove([
      row('a', 'acknowledged', 'recruiter_reply'),
      row('b', 'acknowledged', 'confirmation'),
      row('c', 'lead'),
      row('d', 'drafting'),
      row('e', 'offer'),
      row('f', 'rejected'),
      row('g', 'ghosted'),
    ]);
    expect(live.onYou.map((r) => r.applicationId)).toEqual(['e', 'a']);
    expect(live.waiting.map((r) => r.applicationId)).toEqual(['b']);
    expect(live.unsent.map((r) => r.applicationId).sort()).toEqual(['c', 'd']);
    // Pipeline's live count: everything not closed, leads included.
    expect(live.total).toBe(5);
  });

  it('puts the move on you when mail asked you something, whatever came last', () => {
    const live = liveByMove([row('a', 'in_process', 'interview_completed')], new Set(['a']));
    expect(live.onYou).toHaveLength(1);
    expect(live.onYou[0].why).toMatch(/asked you something/);
  });

  it('lists the furthest along first, then the most recently moved', () => {
    const live = liveByMove([
      row('old', 'acknowledged', null, 20),
      row('new', 'acknowledged', null, 2),
      row('far', 'in_process', 'follow_up_sent', 30),
    ]);
    expect(live.waiting.map((r) => r.applicationId)).toEqual(['far', 'new', 'old']);
  });
});

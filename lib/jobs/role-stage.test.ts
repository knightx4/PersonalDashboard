import { describe, expect, it } from 'vitest';
import { closedSummary, roleStage } from './role-stage';

describe('roleStage', () => {
  it('reads each status as the stage the role page builds for', () => {
    expect(roleStage('lead')).toBe('lead');
    expect(roleStage('drafting')).toBe('lead');
    expect(roleStage('submitted')).toBe('applied');
    expect(roleStage('acknowledged')).toBe('applied');
    expect(roleStage('in_process')).toBe('interviewing');
    expect(roleStage('final_round')).toBe('interviewing');
    expect(roleStage('offer')).toBe('interviewing');
    expect(roleStage('rejected')).toBe('closed');
    expect(roleStage('ghosted')).toBe('closed');
    expect(roleStage('withdrawn')).toBe('closed');
    expect(roleStage('role_closed')).toBe('closed');
  });
});

describe('closedSummary', () => {
  const base = { everSubmitted: true, closedOn: '8 Sep 2026', interviewCount: 0 };

  it('says how it ended, when, and how far it got', () => {
    expect(
      closedSummary({ ...base, status: 'rejected', reached: 'in_process', interviewCount: 2 }),
    ).toBe('Rejected on 8 Sep 2026, after 2 interviews.');
    expect(
      closedSummary({ ...base, status: 'rejected', reached: 'final_round', interviewCount: 4 }),
    ).toBe('Rejected on 8 Sep 2026, after reaching the final round, 4 interviews in.');
    expect(closedSummary({ ...base, status: 'ghosted', reached: 'acknowledged' })).toBe(
      'Ghosted on 8 Sep 2026, with no reply from a person before it closed.',
    );
  });

  it('counts a logged interview even when the record says it got no further', () => {
    expect(
      closedSummary({ ...base, status: 'ghosted', reached: 'acknowledged', interviewCount: 1 }),
    ).toBe('Ghosted on 8 Sep 2026, after one interview.');
  });

  it('reads a lead turned down as never sent, and leaves out a missing date', () => {
    expect(
      closedSummary({
        status: 'withdrawn',
        reached: 'lead',
        everSubmitted: false,
        closedOn: null,
        interviewCount: 0,
      }),
    ).toBe('Turned down, before an application went in.');
  });
});

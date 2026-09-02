import { describe, expect, it } from 'vitest';
import { selectGoingQuiet, GOING_QUIET_WINDOW_DAYS } from '@/lib/jobs/today/load';
import type { PipelineRow } from '@/lib/jobs/applications/load';

const GHOST_DAYS = 30;

function row(over: Partial<PipelineRow> = {}): PipelineRow {
  return {
    applicationId: 'a-1',
    roleId: 'r-1',
    companyId: 'c-1',
    companyName: 'Ramp',
    companySlug: 'ramp',
    companyLogoUrl: null,
    roleTitle: 'Strategic Finance Analyst',
    location: null,
    workMode: null,
    status: 'acknowledged',
    source: 'portal',
    attempt: 1,
    excitement: null,
    needsReview: false,
    createdBy: 'email_inferred',
    submittedAt: null,
    confirmationReceivedAt: null,
    firstHumanResponseAt: null,
    closedAt: null,
    outcome: null,
    rejectionStage: null,
    nextAction: null,
    nextActionDue: null,
    lastActivityAt: '2026-08-01T00:00:00Z',
    daysSinceActivity: GHOST_DAYS - GOING_QUIET_WINDOW_DAYS,
    compMinCents: null,
    compMaxCents: null,
    ...over,
  } as PipelineRow;
}

const none = { withInterview: new Set<string>(), alreadyNudged: new Set<string>() };

describe('what counts as about to go quiet', () => {
  it('picks up a pursuit inside the window before it is written off', () => {
    const quiet = selectGoingQuiet([row()], { ghostDays: GHOST_DAYS, ...none });
    expect(quiet).toHaveLength(1);
    expect(quiet[0].daysUntilGhosted).toBe(GOING_QUIET_WINDOW_DAYS);
  });

  it('leaves one alone that has plenty of time left', () => {
    expect(
      selectGoingQuiet([row({ daysSinceActivity: 3 })], { ghostDays: GHOST_DAYS, ...none }),
    ).toHaveLength(0);
  });

  it('never nags about something already decided', () => {
    expect(
      selectGoingQuiet([row({ status: 'rejected' }), row({ status: 'ghosted' })], {
        ghostDays: GHOST_DAYS,
        ...none,
      }),
    ).toHaveLength(0);
  });

  it('does not call a pursuit with an interview booked quiet', () => {
    // The last *email* may be old while the thing itself is very much alive.
    const quiet = selectGoingQuiet([row()], {
      ghostDays: GHOST_DAYS,
      withInterview: new Set(['a-1']),
      alreadyNudged: new Set(),
    });
    expect(quiet).toHaveLength(0);
  });

  it('does not say it twice when a nudge is already on the page', () => {
    const quiet = selectGoingQuiet([row()], {
      ghostDays: GHOST_DAYS,
      withInterview: new Set(),
      alreadyNudged: new Set(['a-1']),
    });
    expect(quiet).toHaveLength(0);
  });

  it('puts the ones closest to being written off first', () => {
    const quiet = selectGoingQuiet(
      [
        row({ applicationId: 'a-1', daysSinceActivity: 24 }),
        row({ applicationId: 'a-2', daysSinceActivity: 29 }),
        row({ applicationId: 'a-3', daysSinceActivity: 26 }),
      ],
      { ghostDays: GHOST_DAYS, ...none },
    );
    expect(quiet.map((q) => q.applicationId)).toEqual(['a-2', 'a-3', 'a-1']);
  });

  it('follows the threshold the user set, not the default', () => {
    // Someone who writes a pursuit off after 60 days should not be told at 23
    // that it is nearly gone.
    expect(
      selectGoingQuiet([row({ daysSinceActivity: 23 })], { ghostDays: 60, ...none }),
    ).toHaveLength(0);
    expect(
      selectGoingQuiet([row({ daysSinceActivity: 55 })], { ghostDays: 60, ...none }),
    ).toHaveLength(1);
  });

  it('leaves out one the user has dismissed', () => {
    const quiet = selectGoingQuiet([row()], {
      ghostDays: GHOST_DAYS,
      withInterview: new Set(),
      alreadyNudged: new Set(),
      dismissed: new Set(['a-1']),
    });
    expect(quiet).toHaveLength(0);
  });

  it('never reports a negative countdown for one already past the line', () => {
    const quiet = selectGoingQuiet([row({ daysSinceActivity: 45 })], {
      ghostDays: GHOST_DAYS,
      ...none,
    });
    expect(quiet[0].daysUntilGhosted).toBe(0);
  });
});

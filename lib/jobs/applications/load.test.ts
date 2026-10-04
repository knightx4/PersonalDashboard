import { describe, expect, it } from 'vitest';
import { formatInterviewWhen, toFunnelApplications, type PipelineRow } from './load';

/**
 * A round can be on the calendar with an hour, agreed for a day whose hour is
 * still being settled, or agreed with no date at all. The third state used to
 * be unreachable — the add form demanded a datetime — and the first two were
 * printed the same way, so a day-only round claimed to start at midnight.
 */
describe('formatInterviewWhen', () => {
  it('gives the hour when the hour is known', () => {
    expect(formatInterviewWhen('2026-09-15T14:30:00.000Z', true, 'UTC')).toBe(
      '15 Sept, 2:30\u00a0PM UTC',
    );
  });

  it('gives the day alone when only the day is settled', () => {
    expect(formatInterviewWhen('2026-09-15T00:00:00.000Z', false, 'UTC')).toBe('15 Sept 2026');
  });

  it('says the date is still to come rather than showing a dash', () => {
    expect(formatInterviewWhen(null, true, 'UTC')).toBe('Date to be set');
    expect(formatInterviewWhen(null, false, 'UTC')).toBe('Date to be set');
  });
});

describe('toFunnelApplications', () => {
  const row = (over: Partial<PipelineRow>): PipelineRow =>
    ({
      applicationId: 'a',
      status: 'ghosted',
      source: 'portal',
      submittedAt: '2026-07-01T00:00:00Z',
      confirmationReceivedAt: null,
      firstHumanResponseAt: '2026-07-03T00:00:00Z',
      outcome: 'ghosted',
      rejectionStage: null,
      ...over,
    }) as PipelineRow;

  it('counts an onsite or panel as a final round when the close left no stage', () => {
    const [onsite, panel, screen] = toFunnelApplications([
      row({ interviewKinds: ['recruiter_screen', 'onsite'] }),
      row({ interviewKinds: ['technical', 'panel'] }),
      row({ interviewKinds: ['recruiter_screen'] }),
    ]);
    expect(onsite.highWaterStatus).toBe('final_round');
    expect(panel.highWaterStatus).toBe('final_round');
    expect(screen.highWaterStatus).toBe('in_process');
  });

  it('enters a pursuit with no submission on its first human reply', () => {
    const [inbound, portal, lead] = toFunnelApplications([
      row({ source: 'recruiter_inbound', submittedAt: null }),
      row({ submittedAt: null }),
      row({ status: 'lead', submittedAt: null }),
    ]);
    expect(inbound.submittedAt).toEqual(new Date('2026-07-03T00:00:00Z'));
    expect(portal.submittedAt).toEqual(new Date('2026-07-03T00:00:00Z'));
    expect(lead.submittedAt).toBeNull();
  });
});

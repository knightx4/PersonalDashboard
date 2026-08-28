import { describe, expect, it } from 'vitest';
import { applyExtraction, verifyExtraction } from '@/lib/jobs/email/extract';

const VALID = {
  classification: 'interview_invite',
  companyName: 'Ramp',
  roleTitle: 'Strategic Finance Analyst',
  atsJobId: '4318822',
  dates: [{ kind: 'interview', at: '2026-05-12T14:00:00Z', timezone: 'America/New_York' }],
  interviewKind: 'recruiter_screen',
  interviewerNames: ['Priya Raman'],
  actionRequired: true,
  summary: 'Recruiter screen invitation for Strategic Finance Analyst',
  confidence: 0.9,
};

describe('schema', () => {
  it('accepts a well-formed extraction', () => {
    const result = applyExtraction(VALID);
    expect(result.ok).toBe(true);
  });

  it('rejects a datetime without a zone, because a three-hour error is worse than nothing', () => {
    const result = applyExtraction({
      ...VALID,
      dates: [{ kind: 'interview', at: '2026-05-12T14:00:00' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('datetime_without_zone');
  });

  it('rejects an unknown classification rather than coercing it', () => {
    const result = applyExtraction({ ...VALID, classification: 'maybe_a_rejection' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('schema');
  });

  it('requires a one-line summary and refuses a pasted body', () => {
    const result = applyExtraction({ ...VALID, summary: 'x'.repeat(500) });
    expect(result.ok).toBe(false);
  });

  it('defaults the optional collections rather than leaving them undefined', () => {
    const result = applyExtraction({
      classification: 'rejection',
      summary: 'Rejected after resume review',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.extracted.dates).toEqual([]);
      expect(result.extracted.interviewerNames).toEqual([]);
      expect(result.extracted.actionRequired).toBe(false);
    }
  });
});

describe('the deterministic gates', () => {
  const extracted = applyExtraction(VALID);
  const value = extracted.ok ? extracted.extracted : null;

  it('refuses an extraction whose company cannot be resolved', () => {
    const result = verifyExtraction(value!, {
      companyResolvable: false,
      receivedAt: new Date('2026-05-01T00:00:00Z'),
      applicationSubmittedAt: new Date('2026-04-01T00:00:00Z'),
      transitionLegal: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_company');
  });

  it('refuses a message that predates the application it would attach to', () => {
    const result = verifyExtraction(value!, {
      companyResolvable: true,
      receivedAt: new Date('2026-03-01T00:00:00Z'),
      applicationSubmittedAt: new Date('2026-04-01T00:00:00Z'),
      transitionLegal: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('predates_application');
  });

  it('refuses to move status backwards, and says the event was still recorded', () => {
    const result = verifyExtraction(value!, {
      companyResolvable: true,
      receivedAt: new Date('2026-05-01T00:00:00Z'),
      applicationSubmittedAt: new Date('2026-04-01T00:00:00Z'),
      transitionLegal: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('illegal_transition');
      expect(result.detail).toMatch(/recorded/);
    }
  });

  it('does not let a high self-reported confidence past any gate', () => {
    const confident = applyExtraction({ ...VALID, confidence: 1 });
    expect(confident.ok).toBe(true);
    const result = verifyExtraction(confident.ok ? confident.extracted : value!, {
      companyResolvable: false,
      receivedAt: null,
      applicationSubmittedAt: null,
      transitionLegal: true,
    });
    expect(result.ok).toBe(false);
  });
});

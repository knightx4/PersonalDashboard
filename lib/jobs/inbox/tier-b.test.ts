/**
 * Which of the two classifiers wins when they disagree.
 *
 * The case that matters is a Greenhouse rejection whose euphemism sits below
 * Tier A's 2000-character preview window: Tier A sees only the opening "thank
 * you for your interest" and calls it an acknowledgement, deterministically and
 * with full confidence. Before this, that verdict was final and the pursuit was
 * created live and stayed live forever.
 */
import { describe, expect, it } from 'vitest';
import { reconcileClassification } from '@/lib/jobs/inbox/tier-b';
import type { ClassifyResult, MessageClassification } from '@/lib/jobs/email/classify';
import type { ExtractedMessage } from '@/lib/jobs/email/extract';

function tierA(
  classification: MessageClassification,
  tier: ClassifyResult['tier'] = 'A',
): ClassifyResult {
  return {
    classification,
    ats: 'greenhouse',
    company: null,
    companyHint: 'yext',
    scheduling: false,
    tier,
  };
}

function extracted(classification: MessageClassification): ExtractedMessage {
  return {
    classification,
    dates: [],
    interviewerNames: [],
    actionRequired: false,
    summary: 'Rejection for Senior Analyst, Strategic Finance role at Yext',
    confidence: 0.9,
  };
}

describe('reconcileClassification', () => {
  it('lets the model overturn a tier-A acknowledgement that is really a rejection', () => {
    expect(
      reconcileClassification(tierA('application_confirmation'), extracted('rejection')),
    ).toBe('rejection');
  });

  it('still prefers tier A everywhere else', () => {
    expect(
      reconcileClassification(tierA('application_confirmation'), extracted('interview_invite')),
    ).toBe('application_confirmation');
    expect(reconcileClassification(tierA('interview_invite'), extracted('rejection'))).toBe(
      'interview_invite',
    );
    expect(reconcileClassification(tierA('offer'), extracted('rejection'))).toBe('offer');
  });

  it('defers to the model when tier A only guessed from the subject', () => {
    expect(
      reconcileClassification(
        tierA('application_confirmation', 'subject_heuristic'),
        extracted('recruiter_outreach'),
      ),
    ).toBe('recruiter_outreach');
  });

  it('falls back to tier A when there is no extraction at all', () => {
    expect(reconcileClassification(tierA('rejection'), null)).toBe('rejection');
  });
});

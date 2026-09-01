import { describe, expect, it } from 'vitest';
import {
  inboundMayMove,
  inferredApplicationNeedsReview,
  unappliedEventNeedsReview,
  type InferredFlagInput,
} from '@/lib/jobs/review/flagging';

function input(over: Partial<InferredFlagInput> = {}): InferredFlagInput {
  return {
    path: 'application',
    classification: 'application_confirmation',
    tier: 'A',
    ats: 'greenhouse',
    companyKind: 'existing',
    ...over,
  };
}

describe('what the inbox opens without asking', () => {
  it('does not ask about a rejection: you cannot be rejected from a job you never applied to', () => {
    expect(inferredApplicationNeedsReview(input({ classification: 'rejection' }))).toBe(false);
  });

  it('treats an assessment and an offer the same way', () => {
    expect(inferredApplicationNeedsReview(input({ classification: 'assessment' }))).toBe(false);
    expect(inferredApplicationNeedsReview(input({ classification: 'offer' }))).toBe(false);
  });

  it('accepts a confirmation from a hiring system', () => {
    expect(inferredApplicationNeedsReview(input({ ats: 'ashby' }))).toBe(false);
  });

  it('asks about a confirmation from an address it does not recognise', () => {
    // The same words from a person's own domain are as likely to be a
    // newsletter as an application.
    expect(inferredApplicationNeedsReview(input({ ats: 'unknown' }))).toBe(true);
    expect(inferredApplicationNeedsReview(input({ ats: 'other' }))).toBe(true);
  });

  it('asks whenever a model was involved, however confident it sounded', () => {
    expect(
      inferredApplicationNeedsReview(input({ classification: 'rejection', tier: 'none' })),
    ).toBe(true);
    expect(inferredApplicationNeedsReview(input({ tier: 'subject_heuristic' }))).toBe(true);
  });

  it('always asks about a lead, because that is the guess it gets wrong', () => {
    // Inbound about a role with nothing on file: whether it belongs in the
    // pipeline at all is a question about your intent, not about the mail.
    expect(
      inferredApplicationNeedsReview(input({ path: 'lead', classification: 'interview_invite' })),
    ).toBe(true);
    expect(
      inferredApplicationNeedsReview(input({ path: 'lead', classification: 'rejection' })),
    ).toBe(true);
  });

  it('does not ask merely because the company record is new', () => {
    // A new company changes the details on the row, not whether the pursuit
    // happened -- and the row is editable either way.
    expect(
      inferredApplicationNeedsReview(input({ classification: 'rejection', companyKind: 'new' })),
    ).toBe(false);
  });
});

describe('events that could not be applied', () => {
  it('stays quiet about an echo', () => {
    expect(unappliedEventNeedsReview('rejection')).toBe(false);
    expect(unappliedEventNeedsReview('confirmation')).toBe(false);
  });

  it('speaks up when something forward-moving lands on a closed pursuit', () => {
    // Either the pursuit is not closed, or the mail is misfiled. Both are
    // worth exactly one look.
    expect(unappliedEventNeedsReview('assessment_sent')).toBe(true);
    expect(unappliedEventNeedsReview('interview_scheduled')).toBe(true);
    expect(unappliedEventNeedsReview('offer')).toBe(true);
  });
});

describe('what inbound mail may move', () => {
  it('leaves a fact alone', () => {
    expect(inboundMayMove('rejected')).toBe(false);
    expect(inboundMayMove('withdrawn')).toBe(false);
    expect(inboundMayMove('role_closed')).toBe(false);
  });

  it('lets mail overrule a ghosting, which was only ever a guess by a clock', () => {
    expect(inboundMayMove('ghosted')).toBe(true);
  });

  it('leaves anything live alone to move normally', () => {
    expect(inboundMayMove('acknowledged')).toBe(true);
    expect(inboundMayMove('in_process')).toBe(true);
  });
});

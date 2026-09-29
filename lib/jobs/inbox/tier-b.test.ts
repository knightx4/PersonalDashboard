/**
 * Which of the two classifiers wins when they disagree.
 *
 * The case that matters is a Greenhouse rejection whose euphemism sits below
 * Tier A's 2000-character preview window: Tier A sees only the opening "thank
 * you for your interest" and calls it an acknowledgement, deterministically and
 * with full confidence. Before this, that verdict was final and the pursuit was
 * created live and stayed live forever.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { PARSER_VERSION } from '@/lib/jobs/email/extract';
import { reconcileClassification, triageWithModels, type TierBResult } from '@/lib/jobs/inbox/tier-b';
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

/**
 * Tier B with Jev in front (plan #1166). Stubbed fetch for Jev and a stubbed
 * Haiku extraction; nothing reaches TypeSafe or Anthropic.
 */
describe('triageWithModels', () => {
  function jevSays(choice: string, confidence: number) {
    return vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: 'jev-1.13.0',
            answers: { answer: { type: 'choice', choice, confidence, probabilities: { [choice]: confidence } } },
            usage: { input_tokens: 800, output_tokens: 10 },
          }),
        ),
    ) as unknown as typeof fetch;
  }

  function haikuSays(classification: MessageClassification | null) {
    return vi.fn(
      async (): Promise<TierBResult> =>
        classification
          ? {
              extracted: { ...extracted(classification), companyName: 'Yext', confidence: 0.6 },
              parserVersion: PARSER_VERSION,
            }
          : { extracted: null, parserVersion: PARSER_VERSION, error: 'model_error' },
    );
  }

  /** A message the rules could not place: Tier A only guessed. */
  const unplaced = tierA('not_relevant', 'none');

  function triage(opts: {
    tierA?: ClassifyResult;
    jev?: typeof fetch;
    haiku: ReturnType<typeof haikuSays>;
    jevEnabled?: boolean;
    spend?: SpendReport[];
  }) {
    return triageWithModels({
      subject: 'Your application',
      fromAddress: 'talent@yext.com',
      replyToAddress: null,
      body: 'Thank you for your interest.',
      tierA: opts.tierA ?? unplaced,
      jevEnabled: opts.jevEnabled ?? true,
      jevApiKey: 'key-1',
      jevFetch: opts.jev,
      extract: opts.haiku,
      onSpend: (report) => opts.spend?.push(report),
    });
  }

  it('takes the label and its confidence from Jev when Jev is sure, and Haiku still reads the facts', async () => {
    const haiku = haikuSays('recruiter_reply');
    const result = await triage({ jev: jevSays('interview_invite', 0.93), haiku });

    expect(result.labelBy).toBe('jev');
    expect(result.extracted).toMatchObject({ classification: 'interview_invite', confidence: 0.93, companyName: 'Yext' });
    expect(haiku).toHaveBeenCalledTimes(1);
    expect(reconcileClassification(unplaced, result.extracted)).toBe('interview_invite');
  });

  it('skips Haiku when Jev is sure the message goes no further', async () => {
    const haiku = haikuSays('rejection');
    const spend: SpendReport[] = [];
    const result = await triage({ jev: jevSays('not_relevant', 0.97), haiku, spend });

    expect(haiku).not.toHaveBeenCalled();
    expect(result).toMatchObject({ labelBy: 'jev', extracted: { classification: 'not_relevant', confidence: 0.97 } });
    expect(spend.map((report) => report.model)).toEqual(['jev-1.13.0']);
  });

  it('uses Haiku’s answer when Jev is under 0.8', async () => {
    const haiku = haikuSays('rejection');
    const result = await triage({ jev: jevSays('application_confirmation', 0.62), haiku });

    expect(result.labelBy).toBe('haiku');
    expect(result.extracted).toMatchObject({ classification: 'rejection', confidence: 0.6 });
  });

  it('uses Haiku’s answer when Jev fails', async () => {
    const down = vi.fn(async () => new Response('overloaded', { status: 529 })) as unknown as typeof fetch;
    const result = await triage({ jev: down, haiku: haikuSays('assessment') });
    expect(result).toMatchObject({ labelBy: 'haiku', extracted: { classification: 'assessment' } });
  });

  it('leaves recruiter_reply, offer and other to Haiku however sure Jev is', async () => {
    for (const label of ['recruiter_reply', 'offer', 'other']) {
      const result = await triage({ jev: jevSays(label, 0.99), haiku: haikuSays('recruiter_outreach') });
      expect(result).toMatchObject({ labelBy: 'haiku', extracted: { classification: 'recruiter_outreach' } });
    }
  });

  it('never calls Jev for an account that has not opted in', async () => {
    const jev = jevSays('not_relevant', 0.99);
    const result = await triage({ jev, haiku: haikuSays('rejection'), jevEnabled: false });
    expect(jev).not.toHaveBeenCalled();
    expect(result).toMatchObject({ labelBy: 'haiku', extracted: { classification: 'rejection' } });
  });

  it('keeps Jev’s label when Haiku’s extraction fails', async () => {
    const result = await triage({ jev: jevSays('rejection', 0.9), haiku: haikuSays(null) });
    expect(result).toMatchObject({ labelBy: 'jev', error: 'model_error', extracted: { classification: 'rejection' } });
  });

  it('lets a sure Jev rejection overturn a Tier A acknowledgement, and Tier A wins otherwise', async () => {
    const ack = tierA('application_confirmation');
    const rejected = await triage({ tierA: ack, jev: jevSays('rejection', 1), haiku: haikuSays('application_confirmation') });
    expect(reconcileClassification(ack, rejected.extracted)).toBe('rejection');

    const invite = tierA('interview_invite');
    const scheduled = await triage({ tierA: invite, jev: jevSays('scheduling', 0.95), haiku: haikuSays('interview_invite') });
    expect(reconcileClassification(invite, scheduled.extracted)).toBe('interview_invite');
  });
});

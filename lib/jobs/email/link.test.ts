/**
 * The linker.
 *
 * These cases are the MVP acceptance criteria for linking, written as tests:
 * a manually created application is picked up by a later email with no manual
 * step; a confirmation for an unlogged application creates one, flagged; no
 * email ever creates a duplicate for a role that already has an open
 * application; and an ambiguous match holds rather than writing.
 */
import { describe, expect, it } from 'vitest';
import {
  AUTO_LINK_THRESHOLD,
  decideLink,
  isDatePlausible,
  normalizeCompanyName,
  scoreCandidate,
  titleSimilarity,
  type LinkCandidate,
  type LinkInput,
} from '@/lib/jobs/email/link';

const COMPANIES = [
  { id: 'c-ramp', name: 'Ramp', domains: ['ramp.com'] },
  { id: 'c-linear', name: 'Linear', domains: ['linear.app'] },
];

function candidate(over: Partial<LinkCandidate> = {}): LinkCandidate {
  return {
    applicationId: 'a-1',
    roleId: 'r-1',
    companyId: 'c-ramp',
    companyName: 'Ramp',
    companyDomains: ['ramp.com'],
    roleTitle: 'Strategic Finance Analyst',
    atsJobId: '4318822',
    submittedAt: new Date('2026-04-01T10:00:00Z'),
    createdAt: new Date('2026-04-01T10:00:00Z'),
    status: 'submitted',
    attempt: 1,
    threadIds: [],
    ...over,
  };
}

function message(over: Partial<LinkInput> = {}): LinkInput {
  return {
    threadId: 'thread-9',
    fromAddress: 'no-reply@us.greenhouse-mail.io',
    replyToAddress: 'careers@ramp.com',
    subject: 'Your application to Ramp',
    bodyPreview: 'Thanks for applying to the Strategic Finance Analyst role.',
    receivedAt: new Date('2026-04-05T10:00:00Z'),
    classification: 'application_confirmation',
    extractedCompany: 'Ramp',
    extractedRole: 'Strategic Finance Analyst',
    extractedAtsJobId: null,
    companyHint: null,
    ...over,
  };
}

describe('normalisation', () => {
  it('strips corporate suffixes so "Ramp Inc." matches "Ramp"', () => {
    expect(normalizeCompanyName('Ramp Inc.')).toBe('ramp');
    expect(normalizeCompanyName('Linear Technologies Ltd')).toBe('linear');
  });

  it('scores similar role titles as similar and different ones as different', () => {
    expect(
      titleSimilarity('Senior Strategic Finance Analyst', 'Strategic Finance Analyst'),
    ).toBeGreaterThan(0.75);
    expect(titleSimilarity('Strategic Finance Analyst', 'Backend Engineer')).toBeLessThan(0.2);
  });
});

describe('exact signals short-circuit everything else', () => {
  it('links by thread with total confidence', () => {
    const scored = scoreCandidate(
      message({ extractedCompany: null, extractedRole: null }),
      candidate({ threadIds: ['thread-9'] }),
    );
    expect(scored.method).toBe('thread');
    expect(scored.confidence).toBe(1);
  });

  it('links by ATS job id even when the company name is absent', () => {
    const scored = scoreCandidate(
      message({
        threadId: null,
        extractedCompany: null,
        extractedRole: null,
        extractedAtsJobId: '4318822',
      }),
      candidate(),
    );
    expect(scored.method).toBe('ats_job_id');
    expect(scored.confidence).toBeGreaterThanOrEqual(AUTO_LINK_THRESHOLD);
  });
});

describe('date plausibility is a filter, not a score', () => {
  it('rejects a message that predates the submission', () => {
    expect(
      isDatePlausible(
        message({ receivedAt: new Date('2026-03-01T10:00:00Z') }),
        candidate(),
      ),
    ).toBe(false);
  });

  it('allows an auto-ack that beats submitted_at across a timezone boundary', () => {
    expect(
      isDatePlausible(
        message({ receivedAt: new Date('2026-04-01T02:00:00Z') }),
        candidate(),
      ),
    ).toBe(true);
  });

  it('never links a message that predates the application, however well it matches', () => {
    const decision = decideLink(
      message({ receivedAt: new Date('2026-01-01T10:00:00Z'), threadId: null }),
      [candidate({ threadIds: ['thread-9'] })],
      { companies: COMPANIES, now: new Date('2026-04-10T10:00:00Z') },
    );
    expect(decision.action).not.toBe('link');
  });
});

describe('the acceptance criteria', () => {
  it('auto-links a later email to a manually created application with no manual step', () => {
    const decision = decideLink(message({ threadId: null }), [candidate()], {
      companies: COMPANIES,
      now: new Date('2026-04-06T10:00:00Z'),
    });
    expect(decision.action).toBe('link');
    if (decision.action === 'link') {
      expect(decision.candidate.applicationId).toBe('a-1');
      expect(decision.confidence).toBeGreaterThanOrEqual(AUTO_LINK_THRESHOLD);
    }
  });

  it('creates a flagged application from a confirmation that was never logged', () => {
    const decision = decideLink(
      message({ threadId: null, extractedRole: 'Product Designer' }),
      [],
      { companies: COMPANIES, now: new Date('2026-04-06T10:00:00Z') },
    );
    expect(decision.action).toBe('create_inferred_application');
    if (decision.action === 'create_inferred_application') {
      expect(decision.company).toEqual({ kind: 'existing', id: 'c-ramp', name: 'Ramp' });
    }
  });

  it('does not create an application from a confirmation older than the window', () => {
    const decision = decideLink(
      message({ threadId: null, receivedAt: new Date('2024-01-05T10:00:00Z') }),
      [],
      { companies: COMPANIES, now: new Date('2026-04-06T10:00:00Z') },
    );
    expect(decision.action).toBe('hold');
  });

  it('covers the whole window the sync actually read, not the last few days', () => {
    // The window used to be seven days measured from today, which meant a
    // first scan over months of mail inferred nothing from any of it: every
    // message it found was already too old on the day it was read.
    const threeMonthsOld = decideLink(
      message({ threadId: null, receivedAt: new Date('2026-01-05T10:00:00Z') }),
      [],
      { companies: COMPANIES, now: new Date('2026-04-06T10:00:00Z') },
    );
    expect(threeMonthsOld.action).toBe('create_inferred_application');
  });

  it('honours a narrower window when the caller passes one', () => {
    const decision = decideLink(
      message({ threadId: null, receivedAt: new Date('2026-01-05T10:00:00Z') }),
      [],
      { companies: COMPANIES, now: new Date('2026-04-06T10:00:00Z'), inferredWindowDays: 30 },
    );
    expect(decision.action).toBe('hold');
  });

  it('holds rather than guessing when two applications match about equally', () => {
    const decision = decideLink(
      message({ threadId: null, extractedRole: null }),
      [
        candidate({ applicationId: 'a-1', roleId: 'r-1', atsJobId: null }),
        candidate({ applicationId: 'a-2', roleId: 'r-2', roleTitle: 'Finance Manager', atsJobId: null }),
      ],
      { companies: COMPANIES, now: new Date('2026-04-06T10:00:00Z') },
    );
    expect(decision.action).toBe('review');
    if (decision.action === 'review') {
      expect(decision.candidates.length).toBeGreaterThanOrEqual(2);
      // The review row must explain itself, or the queue is unusable.
      expect(decision.candidates[0].reasons.length).toBeGreaterThan(0);
    }
  });

  it('prefers the more recent attempt when a role has been applied to twice', () => {
    const decision = decideLink(
      message({ threadId: null, extractedAtsJobId: '4318822' }),
      [
        candidate({
          applicationId: 'a-old',
          attempt: 1,
          submittedAt: new Date('2025-10-01T10:00:00Z'),
          createdAt: new Date('2025-10-01T10:00:00Z'),
          status: 'rejected',
        }),
        candidate({
          applicationId: 'a-new',
          attempt: 2,
          submittedAt: new Date('2026-04-01T10:00:00Z'),
          createdAt: new Date('2026-04-01T10:00:00Z'),
        }),
      ],
      { companies: COMPANIES, now: new Date('2026-04-06T10:00:00Z') },
    );
    expect(decision.action).toBe('link');
    if (decision.action === 'link') {
      expect(decision.candidate.applicationId).toBe('a-new');
    }
  });

  it('never creates a duplicate application when an open one already matches', () => {
    const decision = decideLink(message({ threadId: null }), [candidate()], {
      companies: COMPANIES,
      now: new Date('2026-04-06T10:00:00Z'),
    });
    expect(decision.action).not.toBe('create_inferred_application');
  });

  it('lands inbound about an unapplied role as a lead, not an application', () => {
    const decision = decideLink(
      message({
        threadId: null,
        classification: 'recruiter_outreach',
        fromAddress: 'jordan@linear.app',
        replyToAddress: null,
        subject: 'Opportunity at Linear — Finance Lead',
        extractedCompany: 'Linear',
        extractedRole: 'Finance Lead',
      }),
      [],
      { companies: COMPANIES, now: new Date('2026-04-06T10:00:00Z') },
    );
    expect(decision.action).toBe('create_lead');
    if (decision.action === 'create_lead') {
      expect(decision.company).toEqual({ kind: 'existing', id: 'c-linear', name: 'Linear' });
    }
  });

  describe('a mailbox with no companies on file yet', () => {
    /**
     * The bug this covers: on a first scan, `companies` is empty, so company
     * resolution failed for every message, every message was held, and the
     * pipeline stayed empty while the review queue filled up with dozens of
     * confirmations. Nothing in the ingestion path created a company, so the
     * only escape was adding every role by hand — which is the work the app
     * exists to avoid.
     */
    it('opens a pursuit from a confirmation naming a company it has never seen', () => {
      const decision = decideLink(message({ threadId: null }), [], {
        companies: [],
        now: new Date('2026-04-06T10:00:00Z'),
      });

      expect(decision.action).toBe('create_inferred_application');
      if (decision.action === 'create_inferred_application') {
        expect(decision.company).toEqual({
          kind: 'new',
          name: 'Ramp',
          // The employer's own domain, off the reply-to.
          domain: 'ramp.com',
        });
      }
    });

    it('never takes the ATS as the employer domain', () => {
      // greenhouse.io on a company record would match every Greenhouse
      // customer's mail to that one company.
      const decision = decideLink(
        message({ threadId: null, replyToAddress: null, extractedCompany: 'Ramp' }),
        [],
        { companies: [], now: new Date('2026-04-06T10:00:00Z') },
      );

      if (decision.action === 'create_inferred_application') {
        expect(decision.company).toEqual({ kind: 'new', name: 'Ramp', domain: null });
      } else {
        throw new Error(`expected an inferred application, got ${decision.action}`);
      }
    });

    it('falls back to the ATS subdomain when the body named nobody', () => {
      const decision = decideLink(
        // Subdomains are lowercase by construction, and "monzo-bank" reads as
        // a typo on a page full of properly cased names.
        message({ threadId: null, extractedCompany: null, companyHint: 'monzo-bank' }),
        [],
        { companies: [], now: new Date('2026-04-06T10:00:00Z') },
      );

      if (decision.action === 'create_inferred_application') {
        expect(decision.company).toMatchObject({ kind: 'new', name: 'Monzo Bank' });
      } else {
        throw new Error(`expected an inferred application, got ${decision.action}`);
      }
    });

    it('leaves a name from the body spelled the way the sender spelled it', () => {
      const decision = decideLink(
        message({ threadId: null, extractedCompany: 'iRobot' }),
        [],
        { companies: [], now: new Date('2026-04-06T10:00:00Z') },
      );

      if (decision.action === 'create_inferred_application') {
        expect(decision.company).toMatchObject({ name: 'iRobot' });
      } else {
        throw new Error(`expected an inferred application, got ${decision.action}`);
      }
    });

    it('prefers a company already on file over creating a second one', () => {
      const decision = decideLink(message({ threadId: null }), [], {
        companies: COMPANIES,
        now: new Date('2026-04-06T10:00:00Z'),
      });

      if (decision.action === 'create_inferred_application') {
        expect(decision.company.kind).toBe('existing');
      } else {
        throw new Error(`expected an inferred application, got ${decision.action}`);
      }
    });

    it('refuses to invent a company from a name that is not one', () => {
      for (const name of ['the hiring team', 'Careers', 'no-reply', 'Talent Acquisition']) {
        const decision = decideLink(
          message({ threadId: null, extractedCompany: name, replyToAddress: null }),
          [],
          { companies: [], now: new Date('2026-04-06T10:00:00Z') },
        );
        // A company called "Talent Acquisition" would go on to absorb every
        // later message that failed to resolve.
        expect(decision.action).toBe('hold');
      }
    });

    it('creates a lead, not an application, from cold outreach', () => {
      const decision = decideLink(
        message({
          threadId: null,
          classification: 'recruiter_outreach',
          fromAddress: 'jordan@linear.app',
          replyToAddress: null,
          extractedCompany: 'Linear',
        }),
        [],
        { companies: [], now: new Date('2026-04-06T10:00:00Z') },
      );

      // Counting outreach as an application would put a denominator in the
      // funnel that was never actually sent.
      expect(decision.action).toBe('create_lead');
      if (decision.action === 'create_lead') {
        expect(decision.company).toEqual({ kind: 'new', name: 'Linear', domain: 'linear.app' });
      }
    });

    it('is less confident about a company it just invented', () => {
      const invented = decideLink(message({ threadId: null }), [], {
        companies: [],
        now: new Date('2026-04-06T10:00:00Z'),
      });
      const known = decideLink(message({ threadId: null }), [], {
        companies: COMPANIES,
        now: new Date('2026-04-06T10:00:00Z'),
      });

      if (
        invented.action !== 'create_inferred_application' ||
        known.action !== 'create_inferred_application'
      ) {
        throw new Error('expected both to infer an application');
      }
      expect(invented.confidence).toBeLessThan(known.confidence);
    });
  });

  it('holds a message whose company cannot be resolved at all', () => {
    const decision = decideLink(
      message({
        threadId: null,
        fromAddress: 'sam@harrisonwilde.com',
        replyToAddress: null,
        subject: 'Are you open to a conversation?',
        classification: 'recruiter_outreach',
        extractedCompany: null,
        extractedRole: null,
      }),
      [],
      { companies: COMPANIES, now: new Date('2026-04-06T10:00:00Z') },
    );
    expect(decision.action).toBe('hold');
  });

  it('penalises a candidate at the right company but clearly the wrong role', () => {
    const right = scoreCandidate(message({ threadId: null }), candidate({ atsJobId: null }));
    const wrong = scoreCandidate(
      message({ threadId: null }),
      candidate({ atsJobId: null, roleTitle: 'Warehouse Operative' }),
    );
    expect(wrong.confidence).toBeLessThan(right.confidence);
  });
});

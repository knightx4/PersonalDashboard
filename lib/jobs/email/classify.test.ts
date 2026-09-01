/**
 * The classifier, against real recruiting mail.
 *
 * The corpus lives in lib/jobs/email/fixtures as body .txt files with the expected
 * JSON beside each. It is weighted toward rejections and toward direct
 * recruiter outreach, because those are the two classes where an error costs
 * the most: a missed rejection leaves a dead application counted as live, and
 * missed outreach is the class this product most wants to catch and the one
 * keyword search handles worst.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyMessage, type CompanyDomainHit } from '@/lib/jobs/email/classify';
import { atsVendorForDomain, domainFromAddress } from '@/lib/jobs/email/ats-senders';

const DIR = join(process.cwd(), 'lib/jobs/email/fixtures');

type Expected = {
  classification: string;
  ats: string;
  tier: string;
  company?: string;
  role?: string;
  atsJobId?: string;
  note?: string;
};

type Fixture = {
  name: string;
  from: string | null;
  replyTo: string | null;
  subject: string | null;
  body: string;
  expected: Expected;
};

/** Companies the user already tracks, so domain matching has something to hit. */
const COMPANIES: CompanyDomainHit[] = [
  { id: 'c-ramp', slug: 'ramp', name: 'Ramp', domains: ['ramp.com'] },
  { id: 'c-figma', slug: 'figma', name: 'Figma', domains: ['figma.com'] },
  { id: 'c-linear', slug: 'linear', name: 'Linear', domains: ['linear.app'] },
  { id: 'c-stripe', slug: 'stripe', name: 'Stripe', domains: ['stripe.com'] },
];

function header(raw: string, name: string): string | null {
  const match = raw.match(new RegExp(`^${name}:\\s*(.+)$`, 'im'));
  return match ? match[1].trim() : null;
}

function loadFixtures(): Fixture[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.txt'))
    .sort()
    .map((file) => {
      const raw = readFileSync(join(DIR, file), 'utf8');
      const expected = JSON.parse(
        readFileSync(join(DIR, file.replace(/\.txt$/, '.json')), 'utf8'),
      ) as Expected;
      const blank = raw.indexOf('\n\n');
      return {
        name: file.replace(/\.txt$/, ''),
        from: header(raw, 'From'),
        replyTo: header(raw, 'Reply-To'),
        subject: header(raw, 'Subject'),
        body: blank === -1 ? raw : raw.slice(blank + 2),
        expected,
      };
    });
}

const FIXTURES = loadFixtures();

describe('fixture corpus', () => {
  it('covers at least eight distinct ATS vendors', () => {
    const vendors = new Set(
      FIXTURES.map((f) => f.expected.ats).filter((v) => v !== 'unknown'),
    );
    expect(vendors.size).toBeGreaterThanOrEqual(8);
  });

  it('is weighted toward rejections', () => {
    const rejections = FIXTURES.filter((f) => f.expected.classification === 'rejection');
    expect(rejections.length).toBeGreaterThanOrEqual(7);
  });

  it('includes direct outreach that matches no ATS domain and no application keyword', () => {
    const outreach = FIXTURES.filter(
      (f) => f.expected.classification === 'recruiter_outreach',
    );
    expect(outreach.length).toBeGreaterThanOrEqual(3);
    for (const fixture of outreach) {
      expect(atsVendorForDomain(domainFromAddress(fixture.from))).toBe('unknown');
    }
  });
});

describe('classification', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.name} → ${fixture.expected.classification}`, () => {
      const result = classifyMessage({
        fromAddress: fixture.from,
        replyToAddress: fixture.replyTo,
        subject: fixture.subject,
        bodyPreview: fixture.body.slice(0, 2000),
        companies: COMPANIES,
      });
      expect(result.classification).toBe(fixture.expected.classification);
      expect(result.ats).toBe(fixture.expected.ats);
    });
  }
});

describe('rejection recall', () => {
  const rejections = FIXTURES.filter((f) => f.expected.classification === 'rejection');

  it('catches every euphemism in the corpus', () => {
    const missed = rejections.filter((fixture) => {
      const result = classifyMessage({
        fromAddress: fixture.from,
        replyToAddress: fixture.replyTo,
        subject: fixture.subject,
        bodyPreview: fixture.body.slice(0, 2000),
        companies: COMPANIES,
      });
      return result.classification !== 'rejection';
    });
    expect(missed.map((f) => f.name)).toEqual([]);
  });

  it('never contains the word "rejected" in the corpus, which is the point', () => {
    for (const fixture of rejections) {
      expect(/\breject(ed|ion)\b/i.test(fixture.body), fixture.name).toBe(false);
    }
  });
});

describe('board digests stay out of the review queue', () => {
  it('drops ignored senders outright rather than labelling them', () => {
    // Labelling still meant fetching. Indeed is about roles you have not
    // applied to, so there is nothing a review queue could decide about it.
    for (const from of ['alert@indeed.com', 'noreply@indeedemail.com', 'x@match.indeed.com']) {
      const result = classifyMessage({
        fromAddress: from,
        subject: 'Senior Financial Analyst and 9 more jobs for you',
        bodyPreview: 'New jobs matching your search. Apply now.',
        companies: COMPANIES,
      });
      expect(result.classification, from).toBe('not_relevant');
      expect(result.tier, from).toBe('A');
    }
  });

  it('still labels job alerts from senders that are worth reading otherwise', () => {
    for (const fixture of FIXTURES.filter((f) => f.expected.classification === 'job_alert')) {
      const result = classifyMessage({
        fromAddress: fixture.from,
        replyToAddress: fixture.replyTo,
        subject: fixture.subject,
        bodyPreview: fixture.body.slice(0, 2000),
        companies: COMPANIES,
      });
      expect(result.classification).toBe('job_alert');
    }
  });

  it('drops a sender the user added to their own exclusion list', () => {
    // LinkedIn cannot be excluded outright: real recruiter InMail and "5 jobs
    // for you" share a domain. This is the per-user escape hatch for it.
    const result = classifyMessage({
      fromAddress: 'jobs-noreply@linkedin.com',
      subject: '5 jobs for you: Senior Financial Analyst and more',
      bodyPreview: 'Jobs matching your profile.',
      companies: COMPANIES,
      excludedDomains: ['linkedin.com'],
    });
    expect(result.classification).toBe('not_relevant');
    expect(result.tier).toBe('A');
  });

  it('leaves a sender alone when it is not on the exclusion list', () => {
    const result = classifyMessage({
      fromAddress: 'jobs-noreply@linkedin.com',
      subject: '5 jobs for you: Senior Financial Analyst and more',
      bodyPreview: 'Jobs matching your profile.',
      companies: COMPANIES,
      excludedDomains: ['some-other-board.com'],
    });
    expect(result.classification).not.toBe('not_relevant');
  });
});

describe('a known ATS domain never implies relevance on its own', () => {
  it('classifies vendor marketing from greenhouse.io as not relevant', () => {
    const result = classifyMessage({
      fromAddress: 'marketing@greenhouse.io',
      subject: 'Webinar: the 2026 hiring benchmark report',
      bodyPreview: 'Join us on 14 May. Unsubscribe from marketing emails.',
      companies: COMPANIES,
    });
    expect(result.classification).toBe('not_relevant');
  });
});

import { describe, expect, it } from 'vitest';
import {
  extractCompBand,
  extractRequirements,
  guessSeniority,
  guessWorkMode,
  jdHash,
} from '@/lib/jobs/jd/requirements';

const JD = `Senior Strategic Finance Analyst

About the role
Ramp is looking for a Senior Strategic Finance Analyst to join the team.

What you'll do
• Build and maintain the operating model used by the exec team
• Partner with Sales and Marketing on quota and spend planning
• Own the monthly close variance analysis

What we're looking for
• 4+ years in FP&A, investment banking, or a similar analytical role
• Advanced Excel and comfort with SQL
• Experience owning a forecast end to end

Nice to have
• Experience at a high-growth fintech
• Familiarity with Looker or a comparable BI tool

Compensation
The annual salary range for this role is $145,000 - $175,000, plus equity.

Ramp is an equal opportunity employer. All qualified applicants will receive
consideration without regard to race, colour, religion, or veteran status.`;

describe('extractRequirements', () => {
  const requirements = extractRequirements(JD);

  it('separates must-haves from nice-to-haves', () => {
    const must = requirements.filter((r) => r.kind === 'must_have').map((r) => r.text);
    const nice = requirements.filter((r) => r.kind === 'nice_to_have').map((r) => r.text);
    expect(must).toEqual([
      '4+ years in FP&A, investment banking, or a similar analytical role',
      'Advanced Excel and comfort with SQL',
      'Experience owning a forecast end to end',
    ]);
    expect(nice).toEqual([
      'Experience at a high-growth fintech',
      'Familiarity with Looker or a comparable BI tool',
    ]);
  });

  it('keeps responsibilities as their own kind', () => {
    const responsibilities = requirements.filter((r) => r.kind === 'responsibility');
    expect(responsibilities).toHaveLength(3);
  });

  it('drops the EEO boilerplate that is never a requirement', () => {
    expect(requirements.some((r) => /equal opportunity|without regard/i.test(r.text))).toBe(false);
  });

  it('takes bullets from a headingless description rather than returning nothing', () => {
    const bare = `We need someone who can:
• Own the forecast
• Talk to sales leadership without a script`;
    expect(extractRequirements(bare)).toHaveLength(2);
  });

  it('returns nothing rather than noise for prose with no structure', () => {
    expect(extractRequirements('We are hiring a finance person. Email us.')).toEqual([]);
  });

  it('does not take a single sentence under a heading for a list', () => {
    // "About the role" above is a recognised heading with one line of prose
    // under it. A parser that counted bare lines without counting how many
    // would file that sentence as a responsibility.
    const responsibilities = requirements.filter((r) => r.kind === 'responsibility');
    expect(responsibilities.some((r) => /join the team/.test(r.text))).toBe(false);
  });
});

/**
 * The posting that had six thousand characters of description and an empty
 * requirement map: curled apostrophes in its headings, and a list whose bullet
 * characters did not survive being copied out of the page.
 */
const PASTED = `Who We Are:

Galaxy is a global leader in digital assets, growing the economy that runs on code.

What You’ll Do:

Review quarterly and annual fund NAVs and capital account allocations
Manage the capital activity lifecycle, capital calls and distribution notices
Coordinate the annual audit with fund administrators, auditors and tax preparers

What We’re Looking For:

3-7 years of experience with a strong background in accounting
Experience coordinating with third party fund administrators
A working knowledge of limited partnership agreements and waterfall provisions

Bonus Points:

Experience in digital assets and crypto currencies
Experience with SPVs and co-investment vehicles
Experience in client service or communicating directly with stakeholders

What We Offer:

Competitive base salary and discretionary bonus
Flexible Time Off (paid)
Free daily snacks and weekly breakfasts

Base Salary Range

$125,000 - $180,000 USD`;

describe('extractRequirements on a description pasted without its bullets', () => {
  const requirements = extractRequirements(PASTED);
  const of = (kind: string) => requirements.filter((r) => r.kind === kind).map((r) => r.text);

  it('reads a heading whose apostrophe was curled by the board', () => {
    // "What You’ll Do:" is "What you'll do". Before this the heading matched
    // nothing, so every line under it fell outside any section and the whole
    // description came back empty.
    expect(of('responsibility')).toHaveLength(3);
  });

  it('reads the lists whose bullets were lost on the way in', () => {
    expect(of('must_have')).toEqual([
      '3-7 years of experience with a strong background in accounting',
      'Experience coordinating with third party fund administrators',
      'A working knowledge of limited partnership agreements and waterfall provisions',
    ]);
    expect(of('nice_to_have')).toHaveLength(3);
  });

  it('stops at the heading it does not recognise, so the perks are not requirements', () => {
    // "What We Offer:" is not a requirement heading, and everything under it
    // would otherwise have been read as more of the bonus points above it.
    expect(requirements.some((r) => /snacks|Time Off|base salary/i.test(r.text))).toBe(false);
  });
});

describe('jdHash', () => {
  it('matches a repost with cosmetic differences', () => {
    expect(jdHash('Own the   forecast.\n\nShip it.')).toBe(jdHash('own the forecast ship it'));
  });

  it('differs for a genuinely different posting', () => {
    expect(jdHash('Own the forecast')).not.toBe(jdHash('Own the roadmap'));
  });
});

describe('facts read off the posting', () => {
  it('reads seniority from the title', () => {
    expect(guessSeniority('Senior Strategic Finance Analyst', JD)).toBe('Senior');
    expect(guessSeniority('Head of Finance', '')).toBe('Director+');
  });

  it('reads work mode', () => {
    expect(guessWorkMode('This role is hybrid, three days a week in the office.')).toBe('hybrid');
    expect(guessWorkMode('Fully remote, work from anywhere in the EU.')).toBe('remote');
    expect(guessWorkMode('You will be on-site in our New York office.')).toBe('onsite');
    expect(guessWorkMode('A great team and a great mission.')).toBeNull();
  });

  it('reads a posted comp band in integer cents', () => {
    expect(extractCompBand(JD)).toEqual({
      minCents: 14_500_000,
      maxCents: 17_500_000,
      currency: 'USD',
    });
  });

  it('refuses a band it cannot trust rather than guessing one', () => {
    expect(extractCompBand('We offer a competitive salary and equity.')).toBeNull();
    expect(extractCompBand('Coffee is $5 and lunch is $12, salary discussed at screen.')).toBeNull();
  });
});

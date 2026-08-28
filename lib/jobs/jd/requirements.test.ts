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

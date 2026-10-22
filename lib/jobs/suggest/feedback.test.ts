import { describe, expect, it } from 'vitest';
import { DISMISS_TEXT_LIMIT, FEEDBACK_LIMIT, openingFeedback, type PastOpening } from './feedback';

const row = (over: Partial<PastOpening>): PastOpening => ({
  status: 'open',
  headline: 'Analyst',
  companyName: 'Acme',
  dismissReason: null,
  ...over,
});

describe('openingFeedback', () => {
  it('lists saved roles and turned-down roles with the reason', () => {
    const feedback = openingFeedback([
      row({ status: 'done', headline: 'Strategy Analyst', companyName: 'Bolt' }),
      row({ status: 'dismissed', dismissReason: 'level', headline: 'VP Finance' }),
      row({ status: 'dismissed', headline: 'Old one' }),
      row({ status: 'open' }),
      row({ status: 'expired' }),
    ]);
    expect(feedback.saved).toEqual(['Strategy Analyst at Bolt']);
    expect(feedback.dismissed).toEqual(['VP Finance at Acme (wrong level)', 'Old one at Acme (no reason given)']);
  });

  it('writes the typed reason after the role in place of the fixed one', () => {
    const feedback = openingFeedback([
      row({ status: 'dismissed', headline: 'PM', dismissText: '  Too much\ntravel  ' }),
      row({ status: 'dismissed', headline: 'VP', dismissReason: 'level', dismissText: 'Too senior for now' }),
      row({ status: 'dismissed', headline: 'Ops', dismissReason: 'pay', dismissText: '   ' }),
      row({ status: 'dismissed', headline: 'Old', dismissText: null }),
    ]);
    expect(feedback.dismissed).toEqual([
      'PM at Acme (Too much travel)',
      'VP at Acme (Too senior for now)',
      'Ops at Acme (pay too low)',
      'Old at Acme (no reason given)',
    ]);
  });

  it('cuts a very long typed reason', () => {
    const feedback = openingFeedback([row({ status: 'dismissed', dismissText: 'x'.repeat(DISMISS_TEXT_LIMIT + 50) })]);
    expect(feedback.dismissed[0]).toBe(`Analyst at Acme (${'x'.repeat(DISMISS_TEXT_LIMIT)}...)`);
  });

  it('still excludes a company declined by reason when text was typed too', () => {
    const feedback = openingFeedback([
      row({ status: 'dismissed', dismissReason: 'company', dismissText: 'No agencies', companyName: 'Acme Inc.' }),
    ]);
    expect([...feedback.companies]).toEqual(['acme']);
  });

  it('keeps a company turned down for being that company out', () => {
    const feedback = openingFeedback([
      row({ status: 'dismissed', dismissReason: 'company', companyName: 'Acme Inc.' }),
      row({ status: 'dismissed', dismissReason: 'pay', companyName: 'Bolt' }),
    ]);
    expect([...feedback.companies]).toEqual(['acme']);
  });

  it('reads at most FEEDBACK_LIMIT of each', () => {
    const rows = Array.from({ length: FEEDBACK_LIMIT + 5 }, () => row({ status: 'done' }));
    expect(openingFeedback(rows).saved).toHaveLength(FEEDBACK_LIMIT);
  });
});

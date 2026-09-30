import { describe, expect, it } from 'vitest';
import { FEEDBACK_LIMIT, openingFeedback, type PastOpening } from './feedback';

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

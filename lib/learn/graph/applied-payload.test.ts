import { describe, expect, it } from 'vitest';
import { asksTheClaimBack, toAppliedCase } from './applied-payload';

/**
 * The rules an applied case has to pass, checked without a network.
 *
 * Both of them are ways a case comes back reading well and measures nothing:
 * the answer sitting in the situation, and the situation being the claim with
 * a question mark after it.
 */

const CLAIM = 'Wages adjust more slowly than prices do.';

const GOOD = {
  situation:
    'A supermarket chain repriced its shelves twice in March after its suppliers put costs up. Its checkout staff are on a contract signed last autumn that runs to next June.',
  question: 'What happens to what the checkout staff can buy with a shift of work, by May?',
  expected: 'Less than in March, because the till has moved and the contract fixes their cash pay until June.',
  unusable: false,
};

describe('a case that can be asked', () => {
  it('comes back with the situation, the question and the expected answer', () => {
    const result = toAppliedCase(GOOD, CLAIM);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.case.situation).toContain('supermarket chain');
      expect(result.case.question).toContain('checkout staff');
      expect(result.case.expected).toContain('contract');
    }
  });

  it('keeps the check it was aimed at, which the model never reported', () => {
    const result = toAppliedCase(GOOD, CLAIM, 'Says which of two prices moves first');
    expect(result.ok && result.case.masteryCheck).toBe('Says which of two prices moves first');
  });

  it('has no check when the concept carries none', () => {
    const result = toAppliedCase(GOOD, CLAIM);
    expect(result.ok && result.case.masteryCheck).toBe(null);
  });

  it('trims what the model sent', () => {
    const result = toAppliedCase({ ...GOOD, question: `  ${GOOD.question}  ` }, CLAIM);
    expect(result.ok && result.case.question.startsWith('What')).toBe(true);
  });
});

describe('a case that cannot', () => {
  it('drops the claim that cannot carry one', () => {
    const result = toAppliedCase({ ...GOOD, unusable: true }, CLAIM);
    expect(result).toEqual({ ok: false, reason: 'unusable' });
  });

  it('refuses a question that hands back the answer', () => {
    const result = toAppliedCase(
      {
        ...GOOD,
        question: 'Given the contract that fixes their cash pay, and a till that has moved, what follows?',
        expected: 'The contract fixes their cash pay while the till has moved.',
      },
      CLAIM,
    );
    expect(result).toEqual({ ok: false, reason: 'gives-away-answer' });
  });

  it('refuses the answer sitting in the situation rather than the question', () => {
    // Read together, because they are read together: which half the answer is
    // in makes no difference to somebody who can read it out of the case.
    const result = toAppliedCase(
      {
        ...GOOD,
        situation: 'A contract fixes their cash pay for a year while the till has moved twice.',
        expected: 'The contract fixes their cash pay while the till has moved.',
      },
      CLAIM,
    );
    expect(result).toEqual({ ok: false, reason: 'gives-away-answer' });
  });

  it('refuses the claim asked back as a situation', () => {
    const result = toAppliedCase(
      { ...GOOD, situation: 'Prices adjust. Wages adjust more slowly.' },
      CLAIM,
    );
    expect(result).toEqual({ ok: false, reason: 'asks-the-claim-back' });
  });
});

describe('the claim asked back', () => {
  it('is a situation with nothing in it the claim does not have', () => {
    expect(asksTheClaimBack('Wages adjust slowly; prices adjust.', CLAIM)).toBe(true);
  });

  it('is not a situation that shares two or three words with the claim', () => {
    expect(
      asksTheClaimBack(
        'A bakery raises its prices in January and its staff ask for a rise in June.',
        CLAIM,
      ),
    ).toBe(false);
  });

  it('is not judged when the situation has nothing distinctive to compare', () => {
    // Nothing to measure rather than a pass: a two-word situation is caught by
    // the schema's own minimum, not by a rule about the claim.
    expect(asksTheClaimBack('It goes up.', CLAIM)).toBe(false);
  });
});

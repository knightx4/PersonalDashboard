import { describe, expect, it } from 'vitest';
import { budgetSlip, sameStepTitle, slipRow } from './slips';

/** The chat slips Dev Home counts (plan #2999). */

describe('sameStepTitle', () => {
  it('reads the same words in another case or with other punctuation as a repeat', () => {
    expect(sameStepTitle('Show Google Places on the map', 'show google places on the map.')).toBe(true);
    expect(sameStepTitle('Artifact pages: list them', 'Artifact pages, list them')).toBe(true);
  });

  it('reads a near-same title as a repeat and a different one as new', () => {
    expect(sameStepTitle('Add the artifact pages to Dev', 'Add the artifact pages to Dev home')).toBe(true);
    expect(sameStepTitle('Show Google Places on the map', 'Show Google Places reviews on the trip page')).toBe(false);
    expect(sameStepTitle('', 'Anything')).toBe(false);
  });
});

describe('budgetSlip', () => {
  it('keeps nothing for a turn that answered within its limits', () => {
    expect(budgetSlip({ stop: 'answered' }, 'Builder')).toBeNull();
  });

  it('keeps a turn that finished in its one more stretch, and one that ran out again', () => {
    expect(budgetSlip({ stop: 'answered', extended: true }, 'Builder')).toMatchObject({
      kind: 'out_of_budget',
      what: expect.stringContaining('finished in it'),
    });
    expect(budgetSlip({ stop: 'time', extended: true }, 'Builder')?.what).toBe(
      "Builder's turn ran out of its time after one more stretch, and answered with what it had.",
    );
  });
});

describe('slipRow', () => {
  it('keeps only a page path as the link', () => {
    const row = slipRow('u1', { kind: 'thin_step', surface: 'ask', conversation: 'ask:a', href: 'https://x.test', what: ' no   detail ' });
    expect(row).toMatchObject({ user_id: 'u1', href: null, what: 'no detail', tool: null });
  });
});

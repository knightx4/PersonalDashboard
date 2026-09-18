import { describe, expect, it } from 'vitest';
import {
  MAX_PLAN_STEPS,
  normalisePlan,
  planPayloadSchema,
  stepsWithSource,
  stepsWithoutSource,
} from './plan-payload';

/**
 * What a generated plan is allowed to be by the time anybody sees it.
 *
 * The gap cases carry the weight. A plan that quietly drops the two steps it
 * could not source reads as a complete answer to the topic and is not one, and
 * the reader has no way to tell the difference -- which is the failure mode
 * the spec says generation must not have.
 */

const SOURCE = {
  title: 'The Use of Knowledge in Society',
  author: 'F. A. Hayek',
  kind: 'article' as const,
  canonical_url: 'https://www.econlib.org/library/Essays/hykKnw.html',
  access: 'open' as const,
  locator_kind: 'whole' as const,
  locator_basis: 'Short essay, read it in full.',
};

const parse = (input: unknown) => planPayloadSchema.parse(input);

describe('the steps that came back', () => {
  it('keeps the model’s order, because each step assumes the ones before it', () => {
    const steps = normalisePlan(
      parse({
        steps: [
          { subject: 'What a price is', source: SOURCE },
          { subject: 'What a policy rate is', source: SOURCE },
          { subject: 'How one reaches the other', source: SOURCE },
        ],
      }),
    );

    expect(steps.map((step) => step.subject)).toEqual([
      'What a price is',
      'What a policy rate is',
      'How one reaches the other',
    ]);
  });

  it('drops a subject that says the same thing twice', () => {
    const steps = normalisePlan(
      parse({
        steps: [
          { subject: 'What a price is', source: SOURCE },
          { subject: 'what a PRICE is', source: SOURCE },
        ],
      }),
    );

    expect(steps).toHaveLength(1);
  });

  it('caps a long plan rather than handing back a syllabus', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      subject: `Step ${i}`,
      source: SOURCE,
    }));

    expect(normalisePlan(parse({ steps: many }))).toHaveLength(MAX_PLAN_STEPS);
  });

  it('never marks a source verified', () => {
    // Nothing has fetched the document. Only the locate pass, which holds it,
    // may promote a locator.
    const steps = normalisePlan(
      parse({ steps: [{ subject: 'Prices', source: { ...SOURCE, locator_verified: true } }] }),
    );

    expect(steps[0].source?.locator_verified).toBe(false);
  });
});

describe('the steps it could not source', () => {
  it('keeps them, with the reason, instead of dropping them', () => {
    const steps = normalisePlan(
      parse({
        steps: [
          { subject: 'What a price is', source: SOURCE },
          {
            subject: 'How the Bank of England actually operates the corridor',
            no_source_reason: 'Only the Bank’s own paywalled quarterly covers this.',
          },
        ],
      }),
    );

    expect(steps).toHaveLength(2);
    expect(stepsWithSource(steps)).toHaveLength(1);
    expect(stepsWithoutSource(steps)).toHaveLength(1);
    expect(stepsWithoutSource(steps)[0].noSourceReason).toBe(
      'Only the Bank’s own paywalled quarterly covers this.',
    );
  });

  it('says so itself when the model gave no reason', () => {
    const steps = normalisePlan(parse({ steps: [{ subject: 'Something obscure' }] }));

    expect(steps[0].source).toBeNull();
    expect(steps[0].noSourceReason).toBe('Nothing was found for this, and no reason was given.');
  });

  it('treats a source the model gave up on as a gap, not a source', () => {
    // not_found with no url is a title and nothing else. Counting it as a
    // source is how a plan looks complete while sending you nowhere.
    const steps = normalisePlan(
      parse({
        steps: [
          {
            subject: 'Corridor operation',
            source: { ...SOURCE, canonical_url: null, not_found: true },
            no_source_reason: 'Could not find it.',
          },
        ],
      }),
    );

    expect(steps[0].source).toBeNull();
    expect(steps[0].noSourceReason).toBe('Could not find it.');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { planTopic } from './plan-topic';

/**
 * What comes back when you ask for a route through a whole topic.
 *
 * The failure cases carry most of the weight, as they do for suggest.ts and
 * for the same reason: "too broad", "nothing readable exists" and "the search
 * itself broke" are three different things for the reader to do next, and
 * flattening them into one error is how somebody retypes a topic that was
 * never the problem.
 *
 * The case this file exists for, though, is the plan that is partly sourced.
 * That is the normal outcome, not an error, and it has to survive.
 */

function clientReturning(input: unknown) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'tool_use', name: 'report_plan', input }],
      }),
    },
  } as never;
}

const SOURCE = {
  title: 'The Use of Knowledge in Society',
  author: 'F. A. Hayek',
  kind: 'article',
  canonical_url: 'https://www.econlib.org/library/Essays/hykKnw.html',
  access: 'open',
  locator_kind: 'whole',
  locator_basis: 'Short essay, read it in full.',
};

const ask = (client: unknown) =>
  planTopic({
    topic: 'central banking',
    question: 'How does raising a policy rate reach the price of anything?',
    anthropicApiKey: 'test',
    client: client as never,
  });

describe('when it plans the topic', () => {
  it('returns the steps in order', async () => {
    const result = await ask(
      clientReturning({
        steps: [
          { subject: 'What a policy rate is', source: SOURCE },
          { subject: 'How it reaches a mortgage', source: SOURCE },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.steps.map((step) => step.subject)).toEqual([
        'What a policy rate is',
        'How it reaches a mortgage',
      ]);
    }
  });

  it('keeps a step it could not source, with its reason', async () => {
    // The whole point of the step. A plan that hides its gaps reads as the
    // complete route through a topic and is not one.
    const result = await ask(
      clientReturning({
        steps: [
          { subject: 'What a policy rate is', source: SOURCE },
          { subject: 'How the corridor is operated', no_source_reason: 'All paywalled.' },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.steps).toHaveLength(2);
      expect(result.steps[1].source).toBeNull();
      expect(result.steps[1].noSourceReason).toBe('All paywalled.');
    }
  });
});

describe('when it cannot', () => {
  it('says a vague topic is vague rather than guessing at one', async () => {
    const result = await ask(clientReturning({ too_vague: true, steps: [] }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too-vague');
  });

  it('says nothing good exists when no step could be sourced at all', async () => {
    const result = await ask(
      clientReturning({
        steps: [
          { subject: 'One', no_source_reason: 'Nothing.' },
          { subject: 'Two', no_source_reason: 'Nothing.' },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('nothing-good');
  });

  it('separates the search breaking from the topic being wrong', async () => {
    const broken = {
      messages: { create: vi.fn().mockRejectedValue(new Error('socket hang up')) },
    };

    const result = await ask(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('error');
      expect(result.detail).toContain('socket hang up');
    }
  });

  it('reports a malformed plan rather than saving half of it', async () => {
    const result = await ask(clientReturning({ steps: [{ subject: '' }] }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('error');
  });
});

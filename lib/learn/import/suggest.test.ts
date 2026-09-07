import { describe, expect, it, vi } from 'vitest';
import { MAX_SUGGESTIONS, suggestSources } from './suggest';

/**
 * What comes back when you ask for something to read about a subject.
 *
 * The failure cases carry most of the weight here. A search given only a
 * subject has far more room to be wrong than one given a citation, and every
 * way it goes wrong needs a different sentence on the screen: "too broad",
 * "nothing good exists", and "the search itself broke" are three different
 * things for the reader to do next, and flattening them into one error is how
 * somebody ends up retyping a subject that was never the problem.
 */

function clientReturning(input: unknown) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'tool_use', name: 'report_sources', input }],
      }),
    },
  } as never;
}

const HAYEK = {
  title: 'The Use of Knowledge in Society',
  author: 'F. A. Hayek',
  kind: 'article',
  canonical_url: 'https://www.econlib.org/library/Essays/hykKnw.html',
  access: 'open',
  locator_kind: 'whole',
  locator_basis: 'Short essay, read it in full.',
  why: 'Prices as coordination rather than valuation.',
};

const ask = (client: unknown) =>
  suggestSources({
    subject: 'how central banks set rates',
    question: 'How does a policy rate reach the price of anything?',
    anthropicApiKey: 'test',
    client: client as never,
  });

describe('when it finds things', () => {
  it('returns them', async () => {
    const result = await ask(clientReturning({ sources: [HAYEK] }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].title).toBe('The Use of Knowledge in Society');
    }
  });

  it('caps a long list rather than handing back a pile', async () => {
    // The prompt asks for restraint and a model will still overshoot. Four is
    // a queue you work through; ten is a pile you have to sort, which is the
    // thing this module exists to prevent.
    const many = Array.from({ length: 9 }, (_, i) => ({ ...HAYEK, title: `Source ${i}` }));
    const result = await ask(clientReturning({ sources: many }));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sources).toHaveLength(MAX_SUGGESTIONS);
  });

  it('never marks a suggestion verified', async () => {
    // Nothing has fetched the document. Only the locate pass, which holds it,
    // may promote a locator -- and this is the second place that is enforced
    // rather than assumed.
    const result = await ask(
      clientReturning({ sources: [{ ...HAYEK, locator_verified: true }] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sources[0].locator_verified).toBe(false);
  });

  it('drops a source the model itself gave up on', async () => {
    const result = await ask(
      clientReturning({
        sources: [HAYEK, { ...HAYEK, title: 'A guess', not_found: true }],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sources.map((s) => s.title)).toEqual([HAYEK.title]);
  });

  it('keeps a book with no free link, because you can still buy it', async () => {
    const result = await ask(
      clientReturning({
        sources: [
          {
            title: 'Spheres of Justice',
            kind: 'book',
            access: 'purchase',
            price_cents: 2800,
            canonical_url: null,
            locator_kind: 'chapter',
            locator_label: 'Ch. 4, "Money and Commodities"',
            locator_basis: "The publisher's table of contents lists this chapter.",
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sources[0].price_cents).toBe(2800);
  });
});

describe('when it does not', () => {
  it('says a subject is too broad rather than guessing at it', async () => {
    // "business" gets you a reading list for a subject nobody asked about.
    const result = await ask(clientReturning({ sources: [], too_vague: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('too-vague');
      expect(result.detail).toMatch(/broad/i);
    }
  });

  it('ignores sources returned alongside a too-vague admission', async () => {
    // A model that says both "too vague" and here are three things has
    // contradicted itself, and the half to trust is the admission.
    const result = await ask(clientReturning({ sources: [HAYEK], too_vague: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too-vague');
  });

  it('reports finding nothing good, distinctly from breaking', async () => {
    const result = await ask(clientReturning({ sources: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('nothing-good');
      expect(result.detail).toMatch(/junk/i);
    }
  });

  it('does not throw when the call fails', async () => {
    const client = {
      messages: { create: vi.fn().mockRejectedValue(new Error('overloaded')) },
    };
    const result = await ask(client);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('error');
  });

  it('does not throw when the results are malformed', async () => {
    const result = await ask(clientReturning({ sources: [{ nonsense: true }] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('error');
  });

  it('does not throw when the model never calls the tool', async () => {
    const client = {
      messages: {
        create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'I searched a bit' }] }),
      },
    };
    const result = await ask(client);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('error');
  });
});

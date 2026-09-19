import { describe, expect, it, vi } from 'vitest';
import { MAX_SUGGESTIONS, suggestSources } from './suggest';
import type { Aim } from '@/lib/learn/graph/aim';
import type { Rooting } from '@/lib/learn/graph/rooting';

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

/**
 * What the call is actually told about you.
 *
 * The rooting is the difference between a suggestion and a guess, and it is
 * invisible from the result -- the sources come back looking the same either
 * way. So it is checked where it exists: in the message the call was made
 * with. The case that matters most is the empty one. A graph with nothing
 * settled must add nothing, because an "already settled:" heading with no
 * claims under it asserts that this person knows nothing, which is a much
 * stronger claim than the graph is making.
 */
describe('rooting the search in what you know', () => {
  function promptFrom(client: { messages: { create: ReturnType<typeof vi.fn> } }): string {
    const call = client.messages.create.mock.calls[0][0] as {
      messages: Array<{ content: string }>;
    };
    return call.messages[0].content;
  }

  const rooting = (over: Partial<Rooting> = {}): Rooting => ({
    settled: ['Prices carry information about scarcity.'],
    frontier: ['A central bank sets one rate and the rest follow it.'],
    settledOmitted: 0,
    ...over,
  });

  async function search(rooted: Rooting | null) {
    const client = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'tool_use', name: 'report_sources', input: { sources: [HAYEK] } }],
        }),
      },
    };
    await suggestSources({
      subject: 'how central banks set rates',
      rooting: rooted,
      anthropicApiKey: 'test',
      client: client as never,
    });
    return promptFrom(client);
  }

  it('sends the settled claims and where they are', async () => {
    const prompt = await search(rooting());
    expect(prompt).toContain('Prices carry information about scarcity.');
    expect(prompt).toContain('A central bank sets one rate and the rest follow it.');
  });

  it('says nothing about what they know when nothing is settled', async () => {
    const prompt = await search(rooting({ settled: [], frontier: [] }));
    expect(prompt).not.toMatch(/settled/i);
    expect(prompt).not.toMatch(/ready to take on/i);
  });

  it('says how many settled claims it left out rather than dropping them silently', async () => {
    const prompt = await search(rooting({ settledOmitted: 12 }));
    expect(prompt).toContain('12 more');
  });

  it('searches on the subject alone when there is no graph behind the reading', async () => {
    const prompt = await search(null);
    expect(prompt).toContain('how central banks set rates');
    expect(prompt).not.toMatch(/settled/i);
  });
});

/**
 * What the search is told to aim at.
 *
 * Same kind of check as the rooting one below it, and for the same reason: the
 * aim is invisible from the result, so it is checked in the message the call
 * was made with. The two cases are genuinely different searches. Shaky is
 * "teach me this claim"; a named wrong belief is "argue me out of this", and a
 * source that only does the first leaves the wrong belief exactly where it
 * was. A search with no aim has to build the prompt it built before any of
 * this existed, because that is every subject somebody typed for themselves.
 */
describe('aiming the search at a claim', () => {
  const SHAKY: Aim = {
    claim: 'A central bank sets one rate and the rest follow it.',
    state: 'shaky',
    misconception: null,
  };

  async function search(aim: Aim | null) {
    const client = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'tool_use', name: 'report_sources', input: { sources: [HAYEK] } }],
        }),
      },
    };
    await suggestSources({
      subject: 'how central banks set rates',
      aim,
      anthropicApiKey: 'test',
      client: client as never,
    });
    const call = client.messages.create.mock.calls[0][0] as {
      messages: Array<{ content: string }>;
    };
    return call.messages[0].content;
  }

  it('sends the claim and where they stand on it', async () => {
    const prompt = await search(SHAKY);
    expect(prompt).toContain('A central bank sets one rate and the rest follow it.');
    expect(prompt).toContain('it did not land');
  });

  it('sends what they believe instead when there is one', async () => {
    const prompt = await search({
      claim: 'A central bank sets one rate and the rest follow it.',
      state: 'misconception',
      misconception: 'That the central bank sets mortgage rates directly.',
    });
    expect(prompt).toContain('What they believe instead:');
    expect(prompt).toContain('That the central bank sets mortgage rates directly.');
  });

  it('says nothing about a wrong belief when there is not one', async () => {
    const prompt = await search(SHAKY);
    expect(prompt).not.toMatch(/believe instead/i);
  });

  it('builds the prompt it built before, when there is no aim', async () => {
    const prompt = await search(null);
    expect(prompt).toContain('Subject: how central banks set rates');
    expect(prompt).not.toMatch(/stuck on/i);
    expect(prompt).not.toMatch(/where they stand/i);
  });
});

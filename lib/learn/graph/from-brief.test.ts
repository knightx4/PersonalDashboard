import { describe, expect, it, vi } from 'vitest';
import { conceptsFromBrief, splitBriefing, MAX_BRIEF_SECTIONS } from './from-brief';

/**
 * Reading a prepared briefing into claims nobody has learned yet.
 *
 * The chain rules themselves are covered in chain-payload.test.ts. What is
 * left here is what only exists in this file: the split into passes that #145
 * settled, the dedupe across those passes, and the honesty about what came
 * back and could not be placed.
 */

type Reply = { input?: unknown; usage?: unknown; error?: Error };

function clientReturning(...replies: Reply[]) {
  const create = vi.fn();
  for (const reply of replies) {
    if (reply.error) create.mockRejectedValueOnce(reply.error);
    else {
      create.mockResolvedValueOnce({
        content: [{ type: 'tool_use', name: 'report_chain', input: reply.input }],
        usage: reply.usage,
      });
    }
  }
  return { messages: { create } } as never;
}

function createOf(client: unknown) {
  return (client as unknown as { messages: { create: ReturnType<typeof vi.fn> } }).messages.create;
}

const BITCOIN = {
  subject: 'Crypto',
  goal_concept: 'Proof of work buys security with electricity',
  concepts: [
    {
      name: 'A reorg costs what the hash rate costs',
      claim: 'Rewriting a block means out-spending everybody else mining on the same chain.',
      basis: "The briefing's section on Bitcoin states this outright.",
    },
    {
      name: 'Proof of work buys security with electricity',
      claim: 'The chain is expensive to rewrite because it was expensive to write.',
      basis: 'The briefing argues this from the fee history it quotes.',
    },
  ],
  edges: [
    {
      prerequisite: 'A reorg costs what the hash rate costs',
      dependent: 'Proof of work buys security with electricity',
      basis: 'The second claim is the first one generalised.',
    },
  ],
};

const CLASSIC = {
  subject: 'Crypto',
  goal_concept: 'Ethereum Classic kept the chain the fork left behind',
  concepts: [
    {
      name: 'Ethereum Classic kept the chain the fork left behind',
      claim: 'After the DAO fork the minority chain carried on under the old rules.',
      basis: "The briefing's section on Ethereum Classic states this outright.",
    },
    {
      name: 'Proof of work buys security with electricity',
      claim: 'The chain is expensive to rewrite because it was expensive to write.',
      basis: 'The briefing argues this from the fee history it quotes.',
    },
  ],
  edges: [
    {
      prerequisite: 'Proof of work buys security with electricity',
      dependent: 'Ethereum Classic kept the chain the fork left behind',
      basis: 'The split only matters once security is understood as bought.',
    },
  ],
};

const ONE_PASS =
  'Bitcoin is expensive to rewrite because it was expensive to write in the first place.';

const TWO_SECTIONS = `# Bitcoin

Bitcoin is expensive to rewrite because it was expensive to write.

# Ethereum Classic

Ethereum Classic kept the chain the DAO fork left behind.`;

const ask = (
  client: unknown,
  options: {
    briefing?: string;
    subject?: string | null;
    existing?: { id: string; name: string }[];
  } = {},
) =>
  conceptsFromBrief({
    subject: options.subject === undefined ? 'Crypto' : options.subject,
    briefing: options.briefing ?? ONE_PASS,
    existing: options.existing ?? [],
    anthropicApiKey: 'test',
    client: client as never,
  });

describe('cutting the briefing into passes', () => {
  it('splits on the briefing’s own headings', () => {
    const sections = splitBriefing(TWO_SECTIONS);
    expect(sections.map((s) => s.title)).toEqual(['Bitcoin', 'Ethereum Classic']);
    expect(sections[1].text).toContain('DAO fork');
  });

  it('reads a paste with no headings in one pass', () => {
    expect(splitBriefing(ONE_PASS)).toHaveLength(1);
  });

  it('ignores a heading with nothing under it', () => {
    expect(splitBriefing(`# Contents\n\nSome prose about one thing.`)).toHaveLength(1);
  });

  it('groups blank-line blocks rather than calling once per paragraph', () => {
    const long = Array.from({ length: 12 }, (_, i) => `${'x'.repeat(900)} ${i}`).join('\n\n');
    const sections = splitBriefing(long);
    expect(sections.length).toBeGreaterThan(1);
    expect(sections.length).toBeLessThan(12);
  });
});

describe('when the briefing states claims', () => {
  it('returns them as a chain, with the basis it came back with', async () => {
    const result = await ask(clientReturning({ input: BITCOIN }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.chain.nodes.map((n) => n.name)).toContain(
        'A reorg costs what the hash rate costs',
      );
      expect(result.chain.nodes[0].basis).toContain('briefing');
      expect(result.chain.edges).toHaveLength(1);
    }
  });

  it('runs one pass per section, into the subject the first pass named', async () => {
    const client = clientReturning({ input: BITCOIN }, { input: CLASSIC });
    const result = await ask(client, { briefing: TWO_SECTIONS, subject: null });

    expect(createOf(client)).toHaveBeenCalledTimes(2);
    expect(createOf(client).mock.calls[0][0].messages[0].content).not.toContain('Subject:');
    expect(createOf(client).mock.calls[1][0].messages[0].content).toContain('Subject: Crypto');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.chain.subject).toBe('Crypto');
  });

  it('proposes what a later section repeats only once', async () => {
    const result = await ask(clientReturning({ input: BITCOIN }, { input: CLASSIC }), {
      briefing: TWO_SECTIONS,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const names = result.chain.nodes.map((n) => n.name);
      expect(names).toHaveLength(3);
      expect(
        names.filter((n) => n === 'Proof of work buys security with electricity'),
      ).toHaveLength(1);
      expect(result.chain.edges).toHaveLength(2);
    }
  });

  it('tells a later pass what the earlier ones proposed, so it draws an edge instead', async () => {
    const client = clientReturning({ input: BITCOIN }, { input: CLASSIC });
    await ask(client, { briefing: TWO_SECTIONS });

    const second = createOf(client).mock.calls[1][0].messages[0].content as string;
    expect(second).toContain('- A reorg costs what the hash rate costs');
  });

  it('does not propose a concept the subject already holds a second time', async () => {
    const result = await ask(clientReturning({ input: BITCOIN }), {
      existing: [
        {
          id: '5f1c0f2e-0000-4000-8000-000000000001',
          name: 'A reorg costs what the hash rate costs',
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const matched = result.chain.nodes.find(
        (n) => n.name === 'A reorg costs what the hash rate costs',
      );
      expect(matched?.existingId).toBe('5f1c0f2e-0000-4000-8000-000000000001');
      expect(result.chain.nodes.filter((n) => n.existingId === null)).toHaveLength(1);
      expect(result.chain.joined).toBe(1);
    }
  });

  it('names a claim it could not place rather than dropping it quietly', async () => {
    const orphaned = {
      ...BITCOIN,
      concepts: [
        ...BITCOIN.concepts,
        {
          name: 'Bitcoin was worth $64,000 in November',
          claim: 'A price, on a date.',
          basis: 'The briefing quotes it.',
        },
      ],
    };

    const result = await ask(clientReturning({ input: orphaned }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.chain.nodes.map((n) => n.name)).not.toContain(
        'Bitcoin was worth $64,000 in November',
      );
      expect(result.chain.dropped).toContainEqual({
        name: 'Bitcoin was worth $64,000 in November',
        reason: 'nothing said what it sits under or on top of',
      });
    }
  });

  it('names a section that had nothing in it', async () => {
    const result = await ask(
      clientReturning({ input: BITCOIN }, { input: { ...CLASSIC, too_vague: true } }),
      { briefing: TWO_SECTIONS },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.chain.dropped).toContainEqual({
        name: 'Ethereum Classic',
        reason: 'no claim in it that this subject does not already have',
      });
    }
  });

  it('refuses an edge that would close a loop with an earlier section', async () => {
    const backwards = {
      ...CLASSIC,
      concepts: [...CLASSIC.concepts, BITCOIN.concepts[0]],
      edges: [
        {
          prerequisite: 'Proof of work buys security with electricity',
          dependent: 'A reorg costs what the hash rate costs',
          basis: 'The other way round.',
        },
        ...CLASSIC.edges,
      ],
    };

    const result = await ask(clientReturning({ input: BITCOIN }, { input: backwards }), {
      briefing: TWO_SECTIONS,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.chain.dropped.some((d) => d.reason.includes('would close a loop'))).toBe(true);
      expect(result.chain.edges).toHaveLength(2);
    }
  });

  it('reports what every pass spent', async () => {
    const spend = vi.fn();
    await conceptsFromBrief({
      subject: 'Crypto',
      briefing: TWO_SECTIONS,
      existing: [],
      anthropicApiKey: 'test',
      client: clientReturning(
        { input: BITCOIN, usage: { input_tokens: 900, output_tokens: 200 } },
        { input: CLASSIC, usage: { input_tokens: 800, output_tokens: 150 } },
      ) as never,
      onSpend: spend,
    });

    expect(spend).toHaveBeenCalledTimes(2);
    expect(spend.mock.calls[0][0].model).toBe('claude-sonnet-5');
  });

  it('stops after a fixed number of passes and says which were not read', async () => {
    const briefing = Array.from(
      { length: MAX_BRIEF_SECTIONS + 2 },
      (_, i) => `# Section ${i}\n\nSomething claimed about part ${i} of the pack.`,
    ).join('\n\n');

    const client = clientReturning(
      ...Array.from({ length: MAX_BRIEF_SECTIONS }, () => ({ input: BITCOIN })),
    );
    const result = await ask(client, { briefing });

    expect(createOf(client)).toHaveBeenCalledTimes(MAX_BRIEF_SECTIONS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.chain.dropped).toContainEqual({
        name: `Section ${MAX_BRIEF_SECTIONS + 1}`,
        reason: `not read: an import stops after ${MAX_BRIEF_SECTIONS} sections`,
      });
    }
  });
});

describe('one claim referring to another', () => {
  /**
   * A pass places its own mentions against its own claims, the same as its
   * edges. What only this file can see is what happens between passes: two
   * sections reporting the same pair, and one reporting as a mention what
   * another draws as an edge. Both are settled once, at the end, over
   * everything that survived.
   */
  const claim = (name: string) => ({
    name,
    claim: `${name} is the case, for a reason the briefing gives.`,
    basis: "The briefing's section states this outright.",
  });

  const joins = (prerequisite: string, dependent: string) => ({
    prerequisite,
    dependent,
    basis: 'The second claim is the first one carried further.',
  });

  const refers = (source: string, target: string) => ({
    source,
    target,
    basis: 'The section brings the two up together.',
  });

  const FIRST = {
    subject: 'Crypto',
    goal_concept: 'C',
    concepts: [claim('A'), claim('B'), claim('C')],
    edges: [joins('A', 'B'), joins('B', 'C')],
    mentions: [refers('A', 'C'), refers('C', 'A')],
  };

  it('keeps both directions a section reported', async () => {
    const client = clientReturning({ input: FIRST });
    const result = await ask(client, { briefing: ONE_PASS });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chain.mentions.map((row) => [row.source, row.target])).toEqual([
      ['A', 'C'],
      ['C', 'A'],
    ]);
  });

  it('drops one another section turned into a prerequisite', async () => {
    // The second pass says A is needed for C. An edge puts both claims on each
    // other's page already, so the mention the first pass reported is a second
    // line saying less.
    const second = {
      subject: 'Crypto',
      goal_concept: 'C',
      concepts: [claim('A'), claim('C')],
      edges: [joins('A', 'C')],
    };
    const client = clientReturning({ input: FIRST }, { input: second });
    const result = await ask(client, { briefing: TWO_SECTIONS });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chain.mentions).toEqual([]);
  });

  it('counts a pair two sections both reported once', async () => {
    const client = clientReturning({ input: FIRST }, { input: FIRST });
    const result = await ask(client, { briefing: TWO_SECTIONS });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chain.mentions).toHaveLength(2);
  });
});

describe('when the briefing has no claims in it', () => {
  it('comes back as a reason rather than an empty chain', async () => {
    const result = await ask(clientReturning({ input: { ...BITCOIN, too_vague: true } }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('nothing-in-it');
      expect(result.detail).toContain('listing names and numbers');
    }
  });

  it('still reports the spend, because the call happened', async () => {
    const spend = vi.fn();
    await conceptsFromBrief({
      subject: 'Crypto',
      briefing: ONE_PASS,
      existing: [],
      anthropicApiKey: 'test',
      client: clientReturning({
        input: { ...BITCOIN, too_vague: true },
        usage: { input_tokens: 700, output_tokens: 20 },
      }) as never,
      onSpend: spend,
    });

    expect(spend).toHaveBeenCalledTimes(1);
  });

  it('says so for an empty paste without calling anything', async () => {
    const client = clientReturning();
    const result = await ask(client, { briefing: '   \n\n  ' });

    expect(createOf(client)).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('nothing-in-it');
  });
});

describe('when a pass goes wrong', () => {
  it('separates a broken call from a briefing with nothing in it', async () => {
    const result = await ask(clientReturning({ error: new Error('overloaded') }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('error');
      expect(result.detail).toBe('overloaded');
    }
  });

  it('keeps the sections that did work, and names the one that did not', async () => {
    const result = await ask(
      clientReturning({ input: BITCOIN }, { error: new Error('overloaded') }),
      { briefing: TWO_SECTIONS },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.chain.nodes).toHaveLength(2);
      expect(result.chain.dropped).toContainEqual({
        name: 'Ethereum Classic',
        reason: 'could not be read: overloaded',
      });
    }
  });

  it('treats an answer with no tool call as an error', async () => {
    const client = {
      messages: { create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'hm' }] }) },
    } as never;

    const result = await ask(client);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('error');
  });
});

describe('what understanding a node looks like', () => {
  const withChecks = {
    ...BITCOIN,
    concepts: BITCOIN.concepts.map((concept, i) =>
      i === 0
        ? {
            ...concept,
            mastery: [
              'Says what stops a richer miner rewriting last week.',
              'Explains why the cost is in electricity rather than in the software.',
            ],
          }
        : concept,
    ),
  };

  it('carries the checks the briefing produced', async () => {
    const result = await ask(clientReturning({ input: withChecks }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.chain.nodes[0].mastery).toEqual([
        'Says what stops a richer miner rewriting last week.',
        'Explains why the cost is in electricity rather than in the software.',
      ]);
    }
  });

  it('takes a pass that came back with none', async () => {
    const result = await ask(clientReturning({ input: BITCOIN }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.chain.nodes.map((node) => node.mastery)).toEqual([[], []]);
    }
  });

  it('asks for them in the tool schema', async () => {
    const client = clientReturning({ input: BITCOIN });
    await ask(client);
    const tool = createOf(client).mock.calls[0][0].tools[0];
    const concept = tool.input_schema.properties.concepts.items;
    expect(concept.required).toContain('mastery');
    expect(concept.properties.mastery.maxItems).toBe(4);
  });
});

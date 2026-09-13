import { describe, expect, it, vi } from 'vitest';
import { generateChain, type SweptClaim } from './generate';

/**
 * What comes back when you name a goal.
 *
 * The rules doing the real work are tested in chain-payload.test.ts, without a
 * network. What is left here is the part that only makes sense around a call:
 * which model runs, that the spend is reported even when the answer is
 * useless, and that the three failures stay three failures -- a vague goal, a
 * goal you have already covered, and a call that broke are three different
 * next moves for the reader.
 */

function clientReturning(input: unknown, usage?: unknown) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'tool_use', name: 'report_chain', input }],
        usage,
      }),
    },
  } as never;
}

const CHAIN = {
  subject: 'Economics',
  goal_concept: 'Expectations close the gap',
  concepts: [
    { name: 'Wage stickiness', claim: 'Wages lag prices.', basis: 'Standard.' },
    { name: 'Expectations close the gap', claim: 'The gain goes, the inflation stays.', basis: 'Standard.' },
  ],
  edges: [
    {
      prerequisite: 'Wage stickiness',
      dependent: 'Expectations close the gap',
      basis: 'The gap opens because wages lag.',
    },
  ],
};

const ask = (client: unknown, existing: { id: string; name: string }[] = []) =>
  generateChain({
    goal: 'how a policy rate reaches prices',
    subject: 'Economics',
    existing,
    anthropicApiKey: 'test',
    client: client as never,
  });

describe('when it lays out a chain', () => {
  it('returns it, with the goal node in it', async () => {
    const result = await ask(clientReturning(CHAIN));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.chain.nodes.map((n) => n.name)).toContain('Expectations close the gap');
      expect(result.chain.edges).toHaveLength(1);
    }
  });

  it('asks which nodes are doors, and carries the marks back', async () => {
    // Plan #305's answer: the pass that proposes the nodes is what marks them,
    // so the field is in this call's tool schema rather than in one of its own.
    const client = clientReturning({
      ...CHAIN,
      concepts: [
        { ...CHAIN.concepts[0], kind: 'threshold' },
        { ...CHAIN.concepts[1], kind: 'consequence' },
      ],
    });
    const result = await ask(client);

    const create = (client as unknown as { messages: { create: ReturnType<typeof vi.fn> } })
      .messages.create;
    const concept = create.mock.calls[0][0].tools[0].input_schema.properties.concepts.items;
    expect(concept.required).toContain('kind');
    expect(concept.properties.kind.enum).toEqual(['threshold', 'consequence']);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.chain.nodes.map((n) => n.kind)).toEqual(['threshold', 'consequence']);
  });

  it('takes a chain that came back with no marks on it', async () => {
    const result = await ask(clientReturning(CHAIN));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.chain.nodes.map((n) => n.kind)).toEqual([null, null]);
  });

  it('runs on Sonnet, which is what the cost table assumes', async () => {
    const client = clientReturning(CHAIN);
    await ask(client);
    const create = (client as unknown as { messages: { create: ReturnType<typeof vi.fn> } })
      .messages.create;
    expect(create.mock.calls[0][0].model).toBe('claude-sonnet-5');
  });

  it('tells the subject what it already holds, by name and nothing else', async () => {
    // The whole cost story for a goal inside a subject you already have: the
    // names go in so nothing is proposed twice, and the claims stay out.
    const client = clientReturning(CHAIN);
    await ask(client, [{ id: 'x', name: 'Wage stickiness' }]);

    const create = (client as unknown as { messages: { create: ReturnType<typeof vi.fn> } })
      .messages.create;
    const prompt = create.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('Wage stickiness');
  });

  it('carries the claim a selected phrase came from, and asks for the join', async () => {
    // Growth trigger 5. A phrase on its own is a fragment; the claim around it
    // is what says which reading of it was meant, and naming the concept is
    // what gets the new chain attached to it rather than left beside it.
    const client = clientReturning(CHAIN);
    await generateChain({
      goal: 'wage expectations',
      subject: 'Economics',
      existing: [{ id: 'x', name: 'Wage stickiness' }],
      from: { name: 'Wage stickiness', claim: 'Wages lag prices.' },
      anthropicApiKey: 'test',
      client: client as never,
    });

    const create = (client as unknown as { messages: { create: ReturnType<typeof vi.fn> } })
      .messages.create;
    const prompt = create.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('wage expectations');
    expect(prompt).toContain('Wages lag prices.');
    expect(prompt).toContain('join the chain to "Wage stickiness"');
  });

  it('says nothing about a claim when the goal was typed', async () => {
    const client = clientReturning(CHAIN);
    await ask(client);

    const create = (client as unknown as { messages: { create: ReturnType<typeof vi.fn> } })
      .messages.create;
    const prompt = create.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('Goal, in their words:');
    expect(prompt).not.toContain('join the chain to');
  });

  it('reports what the call cost', async () => {
    const reports: { model: string }[] = [];
    await generateChain({
      goal: 'a goal',
      subject: 'Economics',
      existing: [],
      anthropicApiKey: 'test',
      client: clientReturning(CHAIN, { input_tokens: 800, output_tokens: 400 }) as never,
      onSpend: (report) => reports.push(report),
    });

    expect(reports).toEqual([
      { model: 'claude-sonnet-5', usage: { inputTokens: 800, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 400 } },
    ]);
  });
});

describe('when it cannot', () => {
  it('says a vague goal is vague rather than sweeping the subject', async () => {
    const result = await ask(
      clientReturning({ subject: 'Science', goal_concept: 'all of it', too_vague: true, concepts: [], edges: [] }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too-vague');
  });

  it('says so when your graph already covers it', async () => {
    const result = await ask(clientReturning(CHAIN), [
      { id: 'a', name: 'Wage stickiness' },
      { id: 'b', name: 'Expectations close the gap' },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('nothing-new');
  });

  it('separates the call breaking from the goal being wrong', async () => {
    const broken = { messages: { create: vi.fn().mockRejectedValue(new Error('socket hang up')) } };

    const result = await ask(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('error');
      expect(result.detail).toContain('socket hang up');
    }
  });

  it('still reports the spend when the chain came back malformed', async () => {
    const reports: unknown[] = [];
    await generateChain({
      goal: 'a goal',
      subject: null,
      existing: [],
      anthropicApiKey: 'test',
      client: clientReturning({ subject: '', goal_concept: '' }) as never,
      onSpend: (report) => reports.push(report),
    });

    expect(reports).toHaveLength(1);
  });
});

describe('what the opening questions put in front of it', () => {
  /**
   * The answers are a measurement of where somebody is starting from, taken
   * before they read anything, so what matters is that the two halves reach
   * the call as two different instructions: what they hold is not to be
   * proposed back to them, and what they missed is what the chain is for.
   */
  async function promptFor(swept: SweptClaim[] | null) {
    const client = clientReturning(CHAIN);
    await generateChain({
      goal: 'how a policy rate reaches prices',
      subject: null,
      existing: [],
      swept,
      anthropicApiKey: 'test',
      client: client as never,
    });
    const create = (client as unknown as { messages: { create: ReturnType<typeof vi.fn> } })
      .messages.create;
    return create.mock.calls[0][0].messages[0].content as string;
  }

  const SWEPT: SweptClaim[] = [
    { name: 'Wage stickiness', claim: 'Wages adjust more slowly than prices.', outcome: 'right' },
    { name: 'Liquidity trap', claim: 'Rate cuts stop working near zero.', outcome: 'wrong' },
    { name: 'Velocity', claim: 'Money changes hands at a rate that is not fixed.', outcome: 'skipped' },
  ];

  it('names what they got right as already held', async () => {
    const prompt = await promptFor(SWEPT);

    expect(prompt).toContain('already held');
    expect(prompt).toContain('Wage stickiness');
    expect(prompt).toContain('never propose it as something to learn');
  });

  it('names what they missed as what the chain should reach', async () => {
    const prompt = await promptFor(SWEPT);

    expect(prompt).toContain('This is what the chain should reach');
    expect(prompt).toContain('Liquidity trap');
    // A pass is a miss. Not knowing and not saying are the same gap.
    expect(prompt).toContain('Velocity');
  });

  it('says so plainly when they got none of them right', async () => {
    const prompt = await promptFor(SWEPT.map((claim) => ({ ...claim, outcome: 'wrong' as const })));

    expect(prompt).toContain('none of them right');
    expect(prompt).not.toContain('already held');
  });

  it('says nothing about a sweep when there was none', async () => {
    const prompt = await promptFor(null);

    expect(prompt).not.toContain('answered from memory');
    expect(prompt).not.toContain('already held');
  });

  it('builds the same prompt it always did when nothing was asked', async () => {
    expect(await promptFor(null)).toBe(await promptFor([]));
  });
});

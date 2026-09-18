import { describe, expect, it, vi } from 'vitest';
import { conceptsFromPrior } from './from-prior';

/**
 * Reading an account of what somebody already knows.
 *
 * The chain rules are tested in chain-payload.test.ts without a network. What
 * is left here is what only makes sense around the call: that the refusal
 * survives -- a transcript full of course titles must come back as nothing
 * rather than as a graph -- that a subject is offered when there is one and
 * omitted when there is not, and that the spend is reported either way.
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
  goal_concept: 'The LM curve is the wrong half of the model',
  concepts: [
    {
      name: 'Rates are set, not cleared',
      claim: 'A central bank picks the policy rate; it does not fix a money supply and let a market clear one.',
      basis: 'They state this outright about their macro course.',
    },
    {
      name: 'The LM curve is the wrong half of the model',
      claim: 'IS-LM keeps a money-supply story that no central bank has run for decades.',
      basis: 'The argument their account makes.',
    },
  ],
  edges: [
    {
      prerequisite: 'Rates are set, not cleared',
      dependent: 'The LM curve is the wrong half of the model',
      basis: 'The objection only lands once the rate is understood as chosen.',
    },
  ],
};

const ACCOUNT =
  'We spent Macro I on IS-LM and I never believed the LM curve — the central bank sets the rate.';

const ask = (
  client: unknown,
  options: { subject?: string | null; existing?: { id: string; name: string }[] } = {},
) =>
  conceptsFromPrior({
    subject: options.subject === undefined ? 'Economics' : options.subject,
    account: ACCOUNT,
    existing: options.existing ?? [],
    anthropicApiKey: 'test',
    client: client as never,
  });

function createOf(client: unknown) {
  return (client as unknown as { messages: { create: ReturnType<typeof vi.fn> } }).messages.create;
}

describe('when the account states claims', () => {
  it('returns them as a chain', async () => {
    const result = await ask(clientReturning(CHAIN));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.chain.nodes.map((n) => n.name)).toContain('Rates are set, not cleared');
      expect(result.chain.edges).toHaveLength(1);
    }
  });

  it('runs on Sonnet, because the work is refusing to invent rather than extracting', async () => {
    const client = clientReturning(CHAIN);
    await ask(client);
    expect(createOf(client).mock.calls[0][0].model).toBe('claude-sonnet-5');
  });

  it('names the subject when there is one, and leaves it to the model when there is not', async () => {
    const withSubject = clientReturning(CHAIN);
    await ask(withSubject);
    expect(createOf(withSubject).mock.calls[0][0].messages[0].content).toContain(
      'Subject: Economics',
    );

    const without = clientReturning(CHAIN);
    await ask(without, { subject: null });
    expect(createOf(without).mock.calls[0][0].messages[0].content).not.toContain('Subject:');
  });

  it('tells the subject what it already holds, by name and nothing else', async () => {
    const client = clientReturning(CHAIN);
    await ask(client, {
      existing: [{ id: '5f1c0f2e-0000-4000-8000-000000000001', name: 'Rates are set, not cleared' }],
    });

    const content = createOf(client).mock.calls[0][0].messages[0].content as string;
    expect(content).toContain('- Rates are set, not cleared');
    expect(content).not.toContain('5f1c0f2e-0000-4000-8000-000000000001');
  });

  it('reports what it spent', async () => {
    const spend = vi.fn();
    await conceptsFromPrior({
      subject: 'Economics',
      account: ACCOUNT,
      existing: [],
      anthropicApiKey: 'test',
      client: clientReturning(CHAIN, { input_tokens: 900, output_tokens: 200 }),
      onSpend: spend,
    });

    expect(spend).toHaveBeenCalledTimes(1);
    expect(spend.mock.calls[0][0].model).toBe('claude-sonnet-5');
  });
});

describe('when the account is only headings', () => {
  it('comes back as nothing rather than as a graph', async () => {
    const result = await ask(
      clientReturning({ ...CHAIN, too_vague: true, concepts: [], edges: [] }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('nothing-in-it');
  });

  it('says why, so the next paste can be a better one', async () => {
    const result = await ask(clientReturning({ ...CHAIN, too_vague: true }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain('Course titles');
  });

  it('still reports the spend, because the call happened', async () => {
    const spend = vi.fn();
    await conceptsFromPrior({
      subject: 'Economics',
      account: ACCOUNT,
      existing: [],
      anthropicApiKey: 'test',
      client: clientReturning({ ...CHAIN, too_vague: true }, { input_tokens: 800, output_tokens: 20 }),
      onSpend: spend,
    });

    expect(spend).toHaveBeenCalledTimes(1);
  });
});

describe('when the call goes wrong', () => {
  it('separates a broken call from an account with nothing in it', async () => {
    const client = {
      messages: { create: vi.fn().mockRejectedValue(new Error('overloaded')) },
    } as never;

    const result = await ask(client);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('error');
      expect(result.detail).toBe('overloaded');
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
    ...CHAIN,
    concepts: CHAIN.concepts.map((concept, i) =>
      i === 0
        ? {
            ...concept,
            mastery: [
              'Says what the bank does when it wants a lower rate.',
              'Answers the objection that the money supply must clear somewhere.',
            ],
          }
        : concept,
    ),
  };

  it('carries the checks the account produced', async () => {
    const result = await ask(clientReturning(withChecks));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.chain.nodes[0].mastery).toEqual([
        'Says what the bank does when it wants a lower rate.',
        'Answers the objection that the money supply must clear somewhere.',
      ]);
    }
  });

  it('takes a payload that came back with none', async () => {
    const result = await ask(clientReturning(CHAIN));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.chain.nodes.map((node) => node.mastery)).toEqual([[], []]);
    }
  });

  it('asks for them in the tool schema', async () => {
    const client = clientReturning(CHAIN);
    await ask(client);
    const tool = createOf(client).mock.calls[0][0].tools[0];
    const concept = tool.input_schema.properties.concepts.items;
    expect(concept.required).toContain('mastery');
    expect(concept.properties.mastery.maxItems).toBe(4);
  });

  it('asks which of them are doors as well', async () => {
    // Prior learning is one of the five paths a concept reaches the graph by,
    // and a path that skips the mark leaves nodes nobody judged.
    const client = clientReturning(CHAIN);
    await ask(client);
    const tool = createOf(client).mock.calls[0][0].tools[0];
    const concept = tool.input_schema.properties.concepts.items;
    expect(concept.required).toContain('kind');
    expect(concept.properties.kind.enum).toEqual(['threshold', 'consequence']);
  });
});

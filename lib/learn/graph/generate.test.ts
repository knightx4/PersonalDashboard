import { describe, expect, it, vi } from 'vitest';
import { generateChain } from './generate';

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

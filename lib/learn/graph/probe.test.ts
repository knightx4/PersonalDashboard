import { describe, expect, it, vi } from 'vitest';
import { writeProbe } from './probe';

/**
 * The call that writes a question.
 *
 * The item rules are tested in probe-payload.test.ts without a network. What
 * is left here is what only makes sense around the call: that it runs on the
 * cheap model the cost story assumes, that a session's history stays out of
 * the prompt, and that "this claim cannot be asked about" and "this particular
 * question was no good" come back as different things -- the first is a
 * problem with the graph, the second is a reason to ask again.
 */

const GOOD = {
  question: 'Expectations adjust fully. What happens to employment?',
  options: ['It stays high', 'It returns to where it was', 'It falls further'],
  correct_index: 1,
  reason: 'Wages are set with the inflation in mind, so the real wage and employment return.',
};

function clientReturning(input: unknown, usage?: unknown) {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: 'tool_use', name: 'report_question', input }],
    usage,
  });
  return { client: { messages: { create } } as never, create };
}

const ask = (client: unknown, extra: Partial<Parameters<typeof writeProbe>[0]> = {}) =>
  writeProbe({
    concept: 'Expectations close the gap',
    claim: 'Once the inflation is expected, the employment gain disappears and the inflation stays.',
    anthropicApiKey: 'test',
    client: client as never,
    ...extra,
  });

describe('when it writes one', () => {
  it('comes back with the question, the options and the stored reason', async () => {
    const { client } = clientReturning(GOOD);
    const result = await ask(client);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.probe.options).toHaveLength(3);
      expect(result.probe.correctIndex).toBe(1);
      expect(result.probe.reason).toContain('real wage');
    }
  });

  it('runs on Haiku, which is what the cost story assumes', async () => {
    const { client, create } = clientReturning(GOOD);
    await ask(client);
    expect(create.mock.calls[0][0].model).toBe('claude-haiku-4-5');
  });

  it('sends the claim and the questions already asked, and nothing else', async () => {
    // Every call is independent and all the state is in Postgres. A session
    // that carried its history would pay for question one again at question
    // forty, which is the whole difference in what a session costs.
    const { client, create } = clientReturning(GOOD);
    await ask(client, { asked: ['An earlier question about this claim'] });

    const messages = create.mock.calls[0][0].messages;
    expect(messages).toHaveLength(1);
    const prompt = messages[0].content as string;
    expect(prompt).toContain('Once the inflation is expected');
    expect(prompt).toContain('An earlier question about this claim');
  });

  it('says when they have missed this claim before', async () => {
    const { client, create } = clientReturning(GOOD);
    await ask(client, { missedBefore: true });
    expect(create.mock.calls[0][0].messages[0].content).toContain('wrong before');
  });

  it('reports what the question cost', async () => {
    const reports: { model: string }[] = [];
    const { client } = clientReturning(GOOD, { input_tokens: 300, output_tokens: 150 });
    await ask(client, { onSpend: (report) => reports.push(report) });

    expect(reports).toHaveLength(1);
    expect(reports[0].model).toBe('claude-haiku-4-5');
  });
});

describe('when the question is no good', () => {
  it('separates a claim that cannot be asked about from a bad question', async () => {
    // Different problems: one wants the node rewritten, the other wants
    // another try.
    const unusable = await ask(clientReturning({ ...GOOD, unusable: true }).client);
    expect(unusable.ok).toBe(false);
    if (!unusable.ok) expect(unusable.reason).toBe('unusable');

    const rejected = await ask(
      clientReturning({ ...GOOD, reason: 'Because option B is the only one that fits.' }).client,
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.reason).toBe('rejected');
  });

  it('reports a broken call as its own thing', async () => {
    const broken = { messages: { create: vi.fn().mockRejectedValue(new Error('socket hang up')) } };
    const result = await ask(broken);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('error');
      expect(result.detail).toContain('socket hang up');
    }
  });

  it('still reports the spend for a question it threw away', async () => {
    const reports: unknown[] = [];
    const { client } = clientReturning({ ...GOOD, correct_index: 9 }, { input_tokens: 10 });
    await ask(client, { onSpend: (report) => reports.push(report) });
    expect(reports).toHaveLength(1);
  });
});

describe('aiming at one check', () => {
  const CHECK = 'Says what happens to employment when the inflation is expected in advance.';

  it('puts the check above the claim and names the others', async () => {
    const { client, create } = clientReturning(GOOD);
    await ask(client, { check: CHECK, otherChecks: ['Explains the long run.'] });

    const prompt = create.mock.calls[0][0].messages[0].content as string;
    expect(prompt.indexOf(CHECK)).toBeLessThan(prompt.indexOf('The claim:'));
    expect(prompt).toContain('Explains the long run.');
  });

  it('keeps the check beside the question it produced', async () => {
    const { client } = clientReturning(GOOD);
    const result = await ask(client, { check: CHECK });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.probe.masteryCheck).toBe(CHECK);
  });

  it('asks about the claim itself when the concept has no checks', async () => {
    // Exactly as it was before the checks existed, rather than a prompt with
    // an empty line where the check would be.
    const { client, create } = clientReturning(GOOD);
    const result = await ask(client);

    const prompt = create.mock.calls[0][0].messages[0].content as string;
    expect(prompt).not.toContain('check of understanding');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.probe.masteryCheck).toBeNull();
  });
});

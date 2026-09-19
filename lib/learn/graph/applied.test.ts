import { describe, expect, it, vi } from 'vitest';
import { gradeAppliedAnswer, writeAppliedCase } from './applied';

/**
 * The two calls the applied rung is made of.
 *
 * The case rules are tested in applied-payload.test.ts without a network. What
 * is left here is what only makes sense around a call: that both run on the
 * cheap model the cost story assumes, that the prompt carries the claim and the
 * check and nothing else, that "this claim cannot carry a case" and "this
 * particular case was no good" come back as different things, and that a typed
 * answer is graded against the answer that was expected.
 */

const CONCEPT = 'Wages lag prices';
const CLAIM = 'Wages adjust more slowly than prices do.';

const GOOD = {
  situation:
    'A supermarket chain repriced its shelves twice in March after its suppliers put costs up. Its checkout staff are on a contract signed last autumn that runs to next June.',
  question: 'What happens to what the checkout staff can buy with a shift of work, by May?',
  expected: 'Less than in March, because the till has moved and the contract fixes their cash pay until June.',
};

function clientReturning(tool: string, input: unknown, usage?: unknown) {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: 'tool_use', name: tool, input }],
    usage,
  });
  return { client: { messages: { create } } as never, create };
}

const write = (client: unknown, extra: Partial<Parameters<typeof writeAppliedCase>[0]> = {}) =>
  writeAppliedCase({
    concept: CONCEPT,
    claim: CLAIM,
    anthropicApiKey: 'test',
    client: client as never,
    ...extra,
  });

const grade = (client: unknown, response: string) =>
  gradeAppliedAnswer({
    concept: CONCEPT,
    claim: CLAIM,
    situation: GOOD.situation,
    question: GOOD.question,
    expected: GOOD.expected,
    response,
    anthropicApiKey: 'test',
    client: client as never,
  });

describe('writing a case', () => {
  it('comes back with the situation, the question and the answer expected', async () => {
    const { client } = clientReturning('report_case', GOOD);
    const result = await write(client);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.case.situation).toContain('supermarket chain');
      expect(result.case.question).toContain('checkout staff');
      expect(result.case.expected).toContain('until June');
    }
  });

  it('runs on Haiku, which is what the cost story assumes', async () => {
    const { client, create } = clientReturning('report_case', GOOD);
    await write(client);
    expect(create.mock.calls[0][0].model).toBe('claude-haiku-4-5');
  });

  it('sends the claim, the check and the situations already used, and nothing else', async () => {
    const { client, create } = clientReturning('report_case', GOOD);
    await write(client, {
      check: 'Says which of two prices moves first',
      asked: ['An earlier situation about a bakery'],
    });

    const messages = create.mock.calls[0][0].messages;
    expect(messages).toHaveLength(1);
    const prompt = messages[0].content as string;
    expect(prompt).toContain('Wages adjust more slowly');
    expect(prompt).toContain('Says which of two prices moves first');
    expect(prompt).toContain('An earlier situation about a bakery');
  });

  it('keeps the check the case was aimed at', async () => {
    const { client } = clientReturning('report_case', GOOD);
    const result = await write(client, { check: 'Says which of two prices moves first' });
    expect(result.ok && result.case.masteryCheck).toBe('Says which of two prices moves first');
  });

  it('reports what the case cost', async () => {
    const reports: { model: string }[] = [];
    const { client } = clientReturning('report_case', GOOD, {
      input_tokens: 400,
      output_tokens: 180,
    });
    await write(client, { onSpend: (report) => reports.push(report) });

    expect(reports).toHaveLength(1);
    expect(reports[0].model).toBe('claude-haiku-4-5');
  });
});

describe('when the case is no good', () => {
  it('separates a claim that cannot carry a case from a bad case', async () => {
    // Different problems: the first wants the claim rewritten, the second wants
    // another call.
    const unusable = clientReturning('report_case', { ...GOOD, unusable: true });
    const asksItBack = clientReturning('report_case', {
      ...GOOD,
      situation: 'Prices adjust. Wages adjust more slowly.',
    });

    const first = await write(unusable.client);
    const second = await write(asksItBack.client);

    expect(first.ok).toBe(false);
    expect(!first.ok && first.reason).toBe('unusable');
    expect(second.ok).toBe(false);
    expect(!second.ok && second.reason).toBe('rejected');
  });

  it('reports a malformed payload rather than throwing', async () => {
    const { client } = clientReturning('report_case', { situation: 'A case with no question' });
    const result = await write(client);
    expect(!result.ok && result.reason).toBe('rejected');
  });

  it('reports a call that said nothing', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'no tool' }] });
    const result = await write({ messages: { create } });
    expect(!result.ok && result.reason).toBe('error');
  });

  it('reports a failed call rather than throwing', async () => {
    const create = vi.fn().mockRejectedValue(new Error('upstream is down'));
    const result = await write({ messages: { create } });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.detail).toContain('upstream is down');
  });
});

describe('grading what was typed', () => {
  it('returns right or wrong with one sentence of reasoning', async () => {
    const { client } = clientReturning('report_grade', {
      why: 'They said the cash pay is fixed while the till moved, which is the claim used.',
      correct: true,
    });
    const result = await grade(client, 'Their pay buys less, because the contract is fixed to June.');

    expect(result.ok).toBe(true);
    expect(result.ok && result.correct).toBe(true);
    expect(result.ok && result.why).toContain('cash pay');
  });

  it('grades against the answer expected, with the case in front of it', async () => {
    const { client, create } = clientReturning('report_grade', { why: 'Wrong way round.', correct: false });
    await grade(client, 'Their pay buys more.');

    const prompt = create.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('supermarket chain');
    expect(prompt).toContain(GOOD.expected);
    expect(prompt).toContain('Their pay buys more.');
    expect(create.mock.calls[0][0].model).toBe('claude-haiku-4-5');
  });

  it('says the grading failed rather than throwing', async () => {
    const create = vi.fn().mockRejectedValue(new Error('grader is down'));
    const result = await grade({ messages: { create } }, 'Anything');
    expect(result.ok).toBe(false);
  });
});

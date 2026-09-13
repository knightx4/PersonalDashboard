import { describe, expect, it, vi } from 'vitest';
import { gradeOpeningAnswer, writeOpeningQuestions } from './opening-probe';
import { givesAwayAnswer, toWrittenQuestion } from './opening-payload';

/**
 * Ten questions from ten claims, and the grading of what somebody writes back.
 *
 * The properties worth asserting are the ones that only show up around a set
 * of calls: that a claim which cannot carry a question costs that claim rather
 * than the sweep, that the calls do not all go out at once, and that a written
 * answer is graded on the idea rather than on the wording.
 */

const CLAIMS = [
  { name: 'Wage stickiness', claim: 'Wages adjust more slowly than prices do.' },
  { name: 'Liquidity trap', claim: 'Rate cuts stop working once rates are near zero.' },
];

function writer(reply: (index: number) => unknown) {
  let index = 0;
  return {
    messages: {
      create: vi.fn().mockImplementation(async () => ({
        content: [{ type: 'tool_use', name: 'report_question', input: reply(index++) }],
        usage: { input_tokens: 300, output_tokens: 90 },
      })),
    },
  };
}

const GOOD = {
  question: 'A central bank raises its rate. What happens to pay packets over the first year?',
  expected: 'They barely move, because pay is set ahead and renegotiated slowly.',
};

describe('writing a question for each claim', () => {
  it('returns one per claim', async () => {
    const client = writer(() => GOOD);
    const result = await writeOpeningQuestions({
      subject: 'Economics',
      claims: CLAIMS,
      anthropicApiKey: 'test',
      client: client as never,
    });

    expect(result.questions).toHaveLength(2);
    expect(result.dropped).toEqual([]);
    expect(result.questions[0].claimName).toBe('Wage stickiness');
  });

  it('keeps the claims in the order they were named', async () => {
    const client = writer(() => GOOD);
    const result = await writeOpeningQuestions({
      subject: 'Economics',
      claims: [...CLAIMS, { name: 'Third', claim: 'A third thing that can be wrong.' }],
      anthropicApiKey: 'test',
      client: client as never,
      maxInFlight: 3,
    });

    expect(result.questions.map((q) => q.claimName)).toEqual([
      'Wage stickiness',
      'Liquidity trap',
      'Third',
    ]);
  });

  it('drops the claim that cannot carry a question, and carries on', async () => {
    const client = writer((i) => (i === 0 ? { ...GOOD, unusable: true } : GOOD));
    const result = await writeOpeningQuestions({
      subject: 'Economics',
      claims: CLAIMS,
      anthropicApiKey: 'test',
      client: client as never,
    });

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].claimName).toBe('Liquidity trap');
    expect(result.dropped).toEqual([{ name: 'Wage stickiness', reason: 'unusable' }]);
  });

  it('drops a question that carries its own answer', async () => {
    const client = writer(() => ({
      question: 'Why do wages renegotiated slowly barely move when a central bank raises its rate?',
      expected: 'They barely move, because wages are renegotiated slowly.',
    }));
    const result = await writeOpeningQuestions({
      subject: 'Economics',
      claims: [CLAIMS[0]],
      anthropicApiKey: 'test',
      client: client as never,
    });

    expect(result.questions).toEqual([]);
    expect(result.dropped[0].reason).toBe('gives-away-answer');
  });

  it('drops a question that asks what something is called', async () => {
    const client = writer(() => ({
      question: 'What is the term for wages that move more slowly than prices?',
      expected: 'Wage stickiness, or nominal rigidity.',
    }));
    const result = await writeOpeningQuestions({
      subject: 'Economics',
      claims: [CLAIMS[0]],
      anthropicApiKey: 'test',
      client: client as never,
    });

    expect(result.dropped[0].reason).toBe('asks-for-a-name');
  });

  it('names what a broken call dropped rather than losing it', async () => {
    const client = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error('upstream said no')),
      },
    };
    const result = await writeOpeningQuestions({
      subject: 'Economics',
      claims: CLAIMS,
      anthropicApiKey: 'test',
      client: client as never,
    });

    expect(result.questions).toEqual([]);
    expect(result.dropped.map((d) => d.reason)).toEqual(['error', 'error']);
  });

  it('reports what every call cost, including the dropped ones', async () => {
    const reports: { model: string }[] = [];
    const client = writer((i) => (i === 0 ? { ...GOOD, unusable: true } : GOOD));
    await writeOpeningQuestions({
      subject: 'Economics',
      claims: CLAIMS,
      anthropicApiKey: 'test',
      client: client as never,
      onSpend: (report) => reports.push(report),
    });

    expect(reports).toHaveLength(2);
    expect(reports[0].model).toBe('claude-haiku-4-5');
  });
});

describe('how many calls are in flight', () => {
  it('never runs more than the cap at once', async () => {
    let running = 0;
    let peak = 0;
    const client = {
      messages: {
        create: vi.fn().mockImplementation(async () => {
          running += 1;
          peak = Math.max(peak, running);
          await new Promise((resolve) => setTimeout(resolve, 5));
          running -= 1;
          return {
            content: [{ type: 'tool_use', name: 'report_question', input: GOOD }],
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        }),
      },
    };

    const claims = Array.from({ length: 10 }, (_, i) => ({
      name: `Claim ${i}`,
      claim: `The ${i}th thing somebody can be right or wrong about here.`,
    }));

    const result = await writeOpeningQuestions({
      subject: 'Economics',
      claims,
      anthropicApiKey: 'test',
      client: client as never,
      maxInFlight: 3,
    });

    expect(result.questions).toHaveLength(10);
    expect(client.messages.create).toHaveBeenCalledTimes(10);
    expect(peak).toBe(3);
  });

  it('does not start a worker it has no claim for', async () => {
    const client = writer(() => GOOD);
    await writeOpeningQuestions({
      subject: 'Economics',
      claims: [CLAIMS[0]],
      anthropicApiKey: 'test',
      client: client as never,
      maxInFlight: 6,
    });

    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });
});

describe('grading a written answer', () => {
  function grader(input: unknown) {
    return {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'tool_use', name: 'report_grade', input }],
          usage: { input_tokens: 200, output_tokens: 40 },
        }),
      },
    };
  }

  const ask = (client: unknown, onSpend?: (report: { model: string }) => void) =>
    gradeOpeningAnswer({
      claim: CLAIMS[0],
      question: GOOD.question,
      expected: GOOD.expected,
      response: 'not much, pay is agreed in advance',
      anthropicApiKey: 'test',
      client: client as never,
      onSpend: onSpend as never,
    });

  it('takes the verdict and the reasoning behind it', async () => {
    const result = await ask(grader({ why: 'Same mechanism, different words.', correct: true }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.correct).toBe(true);
    expect(result.why).toBe('Same mechanism, different words.');
  });

  it('has no half credit', async () => {
    const result = await ask(grader({ why: 'Right direction, wrong mechanism.', correct: false }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.correct).toBe(false);
  });

  it('reports what the grading cost', async () => {
    const reports: { model: string }[] = [];
    await ask(grader({ why: 'Fine.', correct: true }), (report) => reports.push(report));

    expect(reports).toHaveLength(1);
    expect(reports[0].model).toBe('claude-haiku-4-5');
  });

  it('says so rather than guessing when the grade comes back malformed', async () => {
    const result = await ask(grader({ why: 'Fine.' }));

    expect(result.ok).toBe(false);
  });

  it('says so when the call breaks', async () => {
    const client = { messages: { create: vi.fn().mockRejectedValue(new Error('upstream said no')) } };
    const result = await ask(client);

    expect(result.ok).toBe(false);
  });
});

describe('the check a question has to pass', () => {
  // Pure, and the reason a bad question costs one claim rather than the sweep.
  it('lets an ordinary shared word through', () => {
    expect(
      givesAwayAnswer({
        question: 'What happens to wages in the first year after a rate rise?',
        expected: 'They barely move, because pay is set ahead and renegotiated slowly.',
      }),
    ).toBe(false);
  });

  it('catches a question built out of its own answer', () => {
    expect(
      givesAwayAnswer({
        question: 'Given that wages are renegotiated slowly, what happens to wages renegotiated slowly?',
        expected: 'Wages are renegotiated slowly.',
      }),
    ).toBe(true);
  });

  it('reports the model saying the claim is unusable', () => {
    const result = toWrittenQuestion({ question: 'q', expected: 'a', unusable: true });
    expect(result).toEqual({ ok: false, reason: 'unusable' });
  });
});

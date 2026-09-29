import { describe, expect, it, vi } from 'vitest';
import { recordSpendReports } from '@/lib/core/spend/record';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { askJev, jevRequestBody, JEV_MODEL, parseJevAnswer, type JevQuestion } from './client';

/**
 * The Jev client, against stubbed responses shaped like the examples in
 * docs.typesafe.ai/api. Nothing here reaches TypeSafe.
 */

function respond(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch & {
    mock: { calls: [string, RequestInit][] };
  };
}

const TRIAGE = {
  type: 'choice',
  question: 'Which stage of an application is this email about?',
  options: { applied: 'A confirmation that the application arrived', rejected: null, interview: null },
} as const satisfies JevQuestion;

const CHOICE_RESPONSE = {
  model: 'jev-1.13.0',
  answers: {
    answer: {
      type: 'choice',
      choice: 'rejected',
      probabilities: { applied: 0.02, rejected: 0.95, interview: 0.03 },
      confidence: 0.92,
    },
  },
  usage: { input_tokens: 10_000, output_tokens: 34 },
};

describe('asking Jev', () => {
  it('returns the answer and its confidence, and reports the cost', async () => {
    const fetch = respond(CHOICE_RESPONSE);
    const spend: SpendReport[] = [];

    const result = await askJev({
      state: 'We have decided not to move forward.',
      question: TRIAGE,
      apiKey: 'key-1',
      fetch,
      onSpend: (report) => spend.push(report),
    });

    expect(result).toEqual({
      ok: true,
      model: 'jev-1.13.0',
      answer: {
        type: 'choice',
        choice: 'rejected',
        confidence: 0.92,
        probabilities: { applied: 0.02, rejected: 0.95, interview: 0.03 },
      },
    });
    expect(spend).toEqual([
      {
        model: 'jev-1.13.0',
        usage: { inputTokens: 10_000, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 34 },
      },
    ]);

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer key-1');
    expect(JSON.parse(init.body as string)).toEqual({
      state: 'We have decided not to move forward.',
      model: JEV_MODEL,
      questions: {
        answer: {
          type: 'choice',
          instructions: TRIAGE.question,
          criteria: TRIAGE.options,
        },
      },
    });
  });

  it('writes a core.model_spend row at the Jev rate', async () => {
    const spend: SpendReport[] = [];
    await askJev({
      state: 'text',
      question: TRIAGE,
      apiKey: 'key-1',
      fetch: respond(CHOICE_RESPONSE),
      onSpend: (report) => spend.push(report),
    });

    const insert = vi.fn().mockResolvedValue({ error: null });
    const core = { from: vi.fn().mockReturnValue({ insert }) };
    await recordSpendReports(core as never, 'user-1', { module: 'jobs', operation: 'classify-job-email' }, spend);

    expect(core.from).toHaveBeenCalledWith('model_spend');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        module: 'jobs',
        operation: 'classify-job-email',
        model: 'jev-1.13.0',
        input_tokens: 10_000,
        output_tokens: 34,
        // 10,000 × $0.042 per million, output free: 420 micro-dollars.
        cost_micros: 420,
      }),
    );
  });

  it('fails without a key and never calls out', async () => {
    const fetch = respond(CHOICE_RESPONSE);
    const saved = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      const result = await askJev({ state: 'text', question: TRIAGE, fetch });
      expect(result).toMatchObject({ ok: false, reason: 'no-key' });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      if (saved !== undefined) process.env.TYPESAFE_API_KEY = saved;
    }
  });

  it.each([
    [429, 'rate-limited'],
    [529, 'overloaded'],
    [401, 'refused'],
    [422, 'refused'],
    [500, 'error'],
  ] as const)('reads a %i as %s', async (status, reason) => {
    const result = await askJev({
      state: 'text',
      question: TRIAGE,
      apiKey: 'key-1',
      fetch: respond({ detail: 'no' }, status),
    });
    expect(result).toMatchObject({ ok: false, reason });
  });

  it('turns a network failure into a result rather than a throw', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('connection reset');
    }) as unknown as typeof globalThis.fetch;
    const result = await askJev({ state: 'text', question: TRIAGE, apiKey: 'key-1', fetch });
    expect(result).toEqual({ ok: false, reason: 'error', detail: 'connection reset' });
  });

  it('still reports the cost of a response it could not read', async () => {
    const spend: SpendReport[] = [];
    const result = await askJev({
      state: 'text',
      question: TRIAGE,
      apiKey: 'key-1',
      fetch: respond({ ...CHOICE_RESPONSE, answers: {} }),
      onSpend: (report) => spend.push(report),
    });
    expect(result).toMatchObject({ ok: false, reason: 'malformed' });
    expect(spend).toHaveLength(1);
  });
});

describe('the wire format', () => {
  it('sends a yes/no question as a noul, with criteria only when given', () => {
    expect(jevRequestBody('s', { type: 'yes-no', question: 'Is this a bill?' })).toEqual({
      state: 's',
      model: JEV_MODEL,
      questions: { answer: { type: 'noul', instructions: 'Is this a bill?' } },
    });
    expect(
      jevRequestBody('s', { type: 'yes-no', question: 'Is this a bill?', yes: 'Asks for payment' }),
    ).toMatchObject({ questions: { answer: { criteria: { true: 'Asks for payment' } } } });
  });

  it('sends a score with its levels in order', () => {
    expect(
      jevRequestBody({ title: 'x' }, { type: 'score', question: 'How important?', levels: ['low', 'high'] }),
    ).toMatchObject({
      state: { title: 'x' },
      questions: { answer: { type: 'score', criteria: ['low', 'high'] } },
    });
  });

  it('works out a yes/no confidence from the probability', () => {
    const question = { type: 'yes-no', question: 'q' } as const;
    const yes = parseJevAnswer({ answers: { answer: { type: 'noul', noul: 0.95 } } }, question);
    const unsure = parseJevAnswer({ answers: { answer: { type: 'noul', noul: 0.4 } } }, question);

    expect(yes).toMatchObject({ ok: true, model: JEV_MODEL, answer: { yes: true, probability: 0.95 } });
    expect(yes.ok && yes.answer.confidence).toBeCloseTo(0.9);
    expect(unsure).toMatchObject({ ok: true, answer: { yes: false } });
    expect(unsure.ok && unsure.answer.confidence).toBeCloseTo(0.2);
  });

  it('reads a score into its nearest level', () => {
    const result = parseJevAnswer(
      {
        model: 'jev-1.13.0',
        answers: {
          answer: {
            type: 'score',
            score: 1.05,
            legend: { '0': 'Calm', '1': 'Frustrated', '2': 'Very angry' },
            probabilities: { '0': 0.0, '1': 0.95, '2': 0.05 },
            confidence: 0.92,
          },
        },
      },
      { type: 'score', question: 'q', levels: ['Calm', 'Frustrated', 'Very angry'] },
    );
    expect(result).toEqual({
      ok: true,
      model: 'jev-1.13.0',
      answer: { type: 'score', score: 1.05, level: 1, confidence: 0.92, probabilities: [0, 0.95, 0.05] },
    });
  });

  it('refuses a choice that is not one of the options', () => {
    const body = { answers: { answer: { type: 'choice', choice: 'spam', confidence: 1 } } };
    expect(parseJevAnswer(body, TRIAGE)).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('refuses a score outside the levels', () => {
    const body = { answers: { answer: { type: 'score', score: 4, confidence: 1 } } };
    const question = { type: 'score', question: 'q', levels: ['a', 'b'] } as const;
    expect(parseJevAnswer(body, question)).toMatchObject({ ok: false, reason: 'malformed' });
  });
});

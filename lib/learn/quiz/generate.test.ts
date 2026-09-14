import { describe, expect, it, vi } from 'vitest';
import { enoughToAsk, writeQuizQuestions } from './generate';

/**
 * The questions written from chosen material.
 *
 * What is worth asserting here is what only shows up around a set of calls:
 * that every piece of material gets asked about, that a piece with nothing in
 * it costs that piece rather than the quiz, and that a quiz with too little in
 * it says so instead of being stored.
 */

const SOURCES = [
  { id: 'note-1', title: 'Duration', text: 'Duration is the sensitivity of a bond price to rates. '.repeat(20) },
  { id: 'note-2', title: 'Convexity', text: 'Convexity is the curvature of that relationship. '.repeat(20) },
  { id: 'paste', title: '“The job spec”', text: 'The role is on the rates desk and covers hedging. '.repeat(20) },
];

/** One question per call, unless the reply says otherwise. */
function writer(reply: (call: number) => unknown) {
  let call = 0;
  return {
    messages: {
      create: vi.fn().mockImplementation(async () => ({
        content: [{ type: 'tool_use', name: 'report_questions', input: reply(call++) }],
        usage: { input_tokens: 800, output_tokens: 200 },
      })),
    },
  };
}

const GOOD = {
  questions: [
    {
      question: 'Rates rise by one percent. What happens to a long bond compared with a short one?',
      expected: 'The long one falls further, because more of its cash flow is far away.',
    },
  ],
};

describe('writeQuizQuestions', () => {
  it('asks about every piece of the material', async () => {
    const client = writer(() => GOOD);

    const result = await writeQuizQuestions({
      sources: SOURCES,
      preparingFor: 'An interview on Thursday',
      anthropicApiKey: 'test',
      client: client as never,
    });

    const asked = new Set(result.questions.map((question) => question.sourceId));
    expect(asked).toEqual(new Set(['note-1', 'note-2', 'paste']));
    expect(result.failed).toEqual([]);
  });

  it('names a piece that had nothing answerable in it, and keeps the rest', async () => {
    const client = writer((call) => (call === 0 ? { questions: [], nothing_in_it: true } : GOOD));

    const result = await writeQuizQuestions({
      sources: SOURCES,
      preparingFor: null,
      anthropicApiKey: 'test',
      client: client as never,
      maxInFlight: 1,
    });

    expect(result.empty).toContain('Duration');
    expect(result.questions.length).toBeGreaterThan(0);
    expect(result.questions.every((question) => question.sourceId !== 'note-1')).toBe(true);
  });

  it('drops a question that carries its own answer rather than asking it', async () => {
    const client = writer(() => ({
      questions: [
        {
          question: 'Given the curvature of the relationship between price and rates, what is it?',
          expected: 'The curvature of the relationship between price and rates.',
        },
      ],
    }));

    const result = await writeQuizQuestions({
      sources: [SOURCES[0]!],
      preparingFor: null,
      anthropicApiKey: 'test',
      client: client as never,
    });

    expect(result.questions).toEqual([]);
    expect(enoughToAsk(result)).toBe(false);
  });

  it('survives a call that throws, and says which piece it was', async () => {
    const client = {
      messages: {
        create: vi.fn().mockImplementation(async () => {
          throw new Error('rate limited');
        }),
      },
    };

    const result = await writeQuizQuestions({
      sources: [SOURCES[0]!],
      preparingFor: null,
      anthropicApiKey: 'test',
      client: client as never,
    });

    expect(result.questions).toEqual([]);
    expect(result.failed).toContain('Duration');
  });

  it('records what every call cost, whatever came back', async () => {
    const spent: unknown[] = [];
    const client = writer((call) => (call === 0 ? { questions: [], nothing_in_it: true } : GOOD));

    await writeQuizQuestions({
      sources: SOURCES,
      preparingFor: null,
      anthropicApiKey: 'test',
      client: client as never,
      onSpend: (report) => spent.push(report),
    });

    expect(spent.length).toBe(client.messages.create.mock.calls.length);
  });

  it('has nothing to ask when none of the material has text', async () => {
    const client = writer(() => GOOD);

    const result = await writeQuizQuestions({
      sources: [{ id: 'gone', title: 'Gone', text: '' }],
      preparingFor: null,
      anthropicApiKey: 'test',
      client: client as never,
    });

    expect(result.questions).toEqual([]);
    expect(client.messages.create).not.toHaveBeenCalled();
  });
});

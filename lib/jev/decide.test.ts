import { describe, expect, it, vi } from 'vitest';
import type { SpendReport } from '@/lib/core/spend/pricing';
import type { JevQuestion } from './client';
import { decideWithJev } from './decide';

/**
 * The rule every Jev rollout step uses: Jev's answer at 0.8 confidence or
 * more, the caller's fallback otherwise. Stubbed fetch; nothing reaches
 * TypeSafe or Anthropic.
 */

const QUESTION = {
  type: 'choice',
  question: 'What kind of email is this?',
  options: { bill: null, receipt: null, other: null },
} as const satisfies JevQuestion;

function jevAnswering(choice: 'bill' | 'receipt' | 'other', confidence: number) {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          model: 'jev-1.13.0',
          answers: { answer: { type: 'choice', choice, confidence, probabilities: { [choice]: 0.9 } } },
          usage: { input_tokens: 500, output_tokens: 20 },
        }),
      ),
  ) as unknown as typeof fetch;
}

function haiku(value: string) {
  return vi.fn(async () => value);
}

describe('deciding with Jev', () => {
  it('uses Jev when its confidence is 0.8 or more, and never calls the fallback', async () => {
    const fallback = haiku('from haiku');
    const spend: SpendReport[] = [];

    const decided = await decideWithJev({
      state: 'Your invoice is due',
      question: QUESTION,
      read: (answer) => `from jev: ${answer.choice}`,
      fallback,
      onSpend: (report) => spend.push(report),
      apiKey: 'key-1',
      fetch: jevAnswering('bill', 0.8),
    });

    expect(decided).toMatchObject({ value: 'from jev: bill', by: 'jev', confidence: 0.8 });
    expect(fallback).not.toHaveBeenCalled();
    expect(spend.map((report) => report.model)).toEqual(['jev-1.13.0']);
  });

  it('hands low confidence to the fallback, with Jev’s answer', async () => {
    const fallback = haiku('from haiku');
    const spend: SpendReport[] = [];

    const decided = await decideWithJev({
      state: 'Your invoice is due',
      question: QUESTION,
      read: (answer) => answer.choice,
      fallback,
      onSpend: (report) => spend.push(report),
      apiKey: 'key-1',
      fetch: jevAnswering('receipt', 0.79),
    });

    expect(decided).toMatchObject({
      value: 'from haiku',
      by: 'fallback',
      why: 'low-confidence',
      confidence: 0.79,
      jev: { choice: 'receipt' },
    });
    expect(fallback).toHaveBeenCalledWith(
      expect.objectContaining({ why: 'low-confidence', jev: expect.objectContaining({ choice: 'receipt' }) }),
    );
    // Jev still cost what it cost.
    expect(spend).toHaveLength(1);
  });

  it('hands an API error to the fallback', async () => {
    const fallback = haiku('from haiku');
    const down = vi.fn(async () => new Response('overloaded', { status: 529 })) as unknown as typeof fetch;

    const decided = await decideWithJev({
      state: 'Your invoice is due',
      question: QUESTION,
      read: (answer) => answer.choice,
      fallback,
      apiKey: 'key-1',
      fetch: down,
    });

    expect(decided).toMatchObject({
      value: 'from haiku',
      by: 'fallback',
      why: 'jev-failed',
      failure: { reason: 'overloaded' },
    });
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('takes a different floor when a caller passes one', async () => {
    const decided = await decideWithJev({
      state: 'text',
      question: QUESTION,
      read: (answer) => answer.choice,
      fallback: haiku('from haiku'),
      floor: 0.95,
      apiKey: 'key-1',
      fetch: jevAnswering('bill', 0.9),
    });
    expect(decided.by).toBe('fallback');
  });
  it('never calls Jev for an account that has not opted in', async () => {
    const fetch = jevAnswering('bill', 0.99);
    const fallback = haiku('from haiku');
    const decided = await decideWithJev({
      state: 'text',
      question: QUESTION,
      read: (answer) => answer.choice,
      fallback,
      enabled: false,
      apiKey: 'key-1',
      fetch,
    });
    expect(decided).toMatchObject({ value: 'from haiku', by: 'fallback', why: 'not-enabled' });
    expect(fetch).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledWith({ why: 'not-enabled' });
  });

  it('sends an answer the caller does not trust to the fallback, however sure Jev is', async () => {
    const decided = await decideWithJev({
      state: 'text',
      question: QUESTION,
      read: (answer) => answer.choice,
      fallback: haiku('from haiku'),
      trust: (answer) => answer.choice !== 'other',
      apiKey: 'key-1',
      fetch: jevAnswering('other', 0.99),
    });
    expect(decided).toMatchObject({ value: 'from haiku', why: 'not-trusted', confidence: 0.99 });
  });
});

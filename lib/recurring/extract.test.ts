/**
 * The bill gate with Jev in front (plan #1167). Stubbed fetch for Jev and a
 * stubbed Haiku reading; nothing reaches TypeSafe or Anthropic.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { extractRecurringFromEmail, type RecurringHaikuInput, type RecurringHaikuReading } from './extract';
import type { RecurringExtraction } from './extraction';

function jevSays(choice: string, confidence: number) {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          model: 'jev-1.13.0',
          answers: { answer: { type: 'choice', choice, confidence, probabilities: { [choice]: confidence } } },
          usage: { input_tokens: 600, output_tokens: 0 },
        }),
      ),
  ) as unknown as typeof fetch;
}

const jevDown = vi.fn(async () => new Response('overloaded', { status: 529 })) as unknown as typeof fetch;

const netflix: RecurringExtraction = {
  payee: 'Netflix',
  kind: 'subscription',
  event: 'renewal_notice',
  amountCents: 1549,
  previousAmountCents: null,
  currency: 'USD',
  period: 'month',
  occurredOn: '2026-09-20',
  dueOn: '2026-10-01',
};

function haikuSays(reading: RecurringHaikuReading) {
  return vi.fn(async (input: RecurringHaikuInput) => {
    input.onSpend?.({ model: 'claude-haiku-4-5-20251001', usage: { inputTokens: 2500, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 150 } });
    return reading;
  });
}

function read(opts: {
  jev?: typeof fetch;
  haiku: ReturnType<typeof haikuSays>;
  jevEnabled?: boolean;
  spend?: SpendReport[];
}) {
  return extractRecurringFromEmail({
    subject: 'Your Netflix membership',
    text: 'Your membership renews on October 1 for $15.49/month.',
    fromAddress: 'Netflix <info@account.netflix.com>',
    receivedOn: '2026-09-20',
    hint: 'subscription',
    jevEnabled: opts.jevEnabled ?? true,
    jevApiKey: 'key-1',
    jevFetch: opts.jev,
    haiku: opts.haiku,
    onSpend: (report) => opts.spend?.push(report),
  });
}

describe('extractRecurringFromEmail with Jev', () => {
  it('takes the event from Jev when it is sure, and Haiku still reads the fields', async () => {
    const haiku = haikuSays({ ok: true, value: netflix });
    const spend: SpendReport[] = [];
    const result = await read({ jev: jevSays('charge', 0.95), haiku, spend });

    expect(result).toMatchObject({ ok: true, source: 'llm', value: { payee: 'Netflix', event: 'charge', amountCents: 1549 } });
    expect(haiku).toHaveBeenCalledTimes(1);
    expect(spend.map((r) => r.model)).toEqual(['jev-1.13.0', 'claude-haiku-4-5-20251001']);
  });

  it('files nothing and skips Haiku when Jev is sure it is not a recurring payment', async () => {
    const haiku = haikuSays({ ok: true, value: netflix });
    const spend: SpendReport[] = [];
    const result = await read({ jev: jevSays('not_recurring', 0.9), haiku, spend });

    expect(result).toEqual({ ok: false, notRecurring: true, reason: 'not_recurring' });
    expect(haiku).not.toHaveBeenCalled();
    expect(spend.map((r) => r.model)).toEqual(['jev-1.13.0']);
  });

  it('uses Haiku’s answer, yes or no, when Jev is under 0.8', async () => {
    const yes = await read({ jev: jevSays('not_recurring', 0.6), haiku: haikuSays({ ok: true, value: netflix }) });
    expect(yes).toMatchObject({ ok: true, source: 'llm', value: { event: 'renewal_notice' } });

    const no = await read({ jev: jevSays('charge', 0.6), haiku: haikuSays({ ok: false, notRecurring: true }) });
    expect(no).toEqual({ ok: false, notRecurring: true, reason: 'not_recurring' });
  });

  it('uses Haiku’s answer when the Jev call fails', async () => {
    const spend: SpendReport[] = [];
    const result = await read({ jev: jevDown, haiku: haikuSays({ ok: true, value: netflix }), spend });
    expect(result).toMatchObject({ ok: true, source: 'llm', value: { event: 'renewal_notice' } });
    expect(spend.map((r) => r.model)).toEqual(['claude-haiku-4-5-20251001']);
  });

  it('never calls Jev for an account that has not opted in', async () => {
    const jev = jevSays('not_recurring', 0.99);
    const result = await read({ jev, haiku: haikuSays({ ok: true, value: netflix }), jevEnabled: false });
    expect(jev).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, value: { event: 'renewal_notice' } });
  });

  it('keeps Jev’s event and reads the fields by heuristic when Haiku cannot', async () => {
    const result = await read({ jev: jevSays('renewal_notice', 0.9), haiku: haikuSays(null) });
    expect(result).toMatchObject({ ok: true, source: 'heuristic', value: { event: 'renewal_notice', amountCents: 1549 } });
  });

  it('does not file a charge with no amount because Jev named the event', async () => {
    const noAmount = { ...netflix, event: 'trial_ending' as const, amountCents: null };
    const result = await extractRecurringFromEmail({
      subject: 'Your trial',
      text: 'Thanks for trying us.',
      fromAddress: 'Acme <hi@acme.com>',
      receivedOn: '2026-09-20',
      hint: 'subscription',
      jevEnabled: true,
      jevApiKey: 'key-1',
      jevFetch: jevSays('charge', 0.95),
      haiku: haikuSays({ ok: true, value: noAmount }),
    });
    expect(result).toEqual({ ok: false, notRecurring: false, reason: 'no_extraction' });
  });
});

/**
 * The appointment gate with Jev in front (plan #1167). Stubbed fetch for Jev
 * and a stubbed Haiku reading; nothing reaches TypeSafe or Anthropic.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { extractAppointmentFromEmail, type AppointmentHaikuInput, type AppointmentHaikuReading } from './extract';
import type { AppointmentExtraction } from './extraction';

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

const cleaning: AppointmentExtraction = {
  event: 'booked',
  title: 'Dental cleaning',
  provider: 'Smile Dental',
  reference: null,
  date: '2026-10-07',
  time: '15:30',
  endTime: null,
  location: null,
  previousDate: null,
  previousTime: null,
};

function haikuSays(reading: AppointmentHaikuReading) {
  return vi.fn(async (input: AppointmentHaikuInput) => {
    input.onSpend?.({ model: 'claude-haiku-5-5', usage: { inputTokens: 2500, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 150 } });
    return reading;
  });
}

function read(opts: {
  jev?: typeof fetch;
  haiku: ReturnType<typeof haikuSays>;
  jevEnabled?: boolean;
  spend?: SpendReport[];
  text?: string;
}) {
  return extractAppointmentFromEmail({
    subject: 'Your appointment at Smile Dental',
    text: opts.text ?? 'Your cleaning is on October 7, 2026 at 3:30 PM.',
    fromAddress: 'Smile Dental <hello@smiledental.com>',
    receivedOn: '2026-09-20',
    hint: 'booked',
    jevEnabled: opts.jevEnabled ?? true,
    jevApiKey: 'key-1',
    jevFetch: opts.jev,
    haiku: opts.haiku,
    onSpend: (report) => opts.spend?.push(report),
  });
}

describe('extractAppointmentFromEmail with Jev', () => {
  it('takes the event from Jev when it is sure, and Haiku still reads the fields', async () => {
    const haiku = haikuSays({ ok: true, value: cleaning });
    const spend: SpendReport[] = [];
    const result = await read({ jev: jevSays('reminder', 0.92), haiku, spend });

    expect(result).toMatchObject({ ok: true, source: 'llm', value: { event: 'reminder', date: '2026-10-07', time: '15:30' } });
    expect(haiku).toHaveBeenCalledTimes(1);
    expect(spend.map((r) => r.model)).toEqual(['jev-1.13.0', 'claude-haiku-5-5']);
  });

  it('files nothing and skips Haiku when Jev is sure it is not an appointment', async () => {
    const haiku = haikuSays({ ok: true, value: cleaning });
    const spend: SpendReport[] = [];
    const result = await read({ jev: jevSays('not_appointment', 0.88), haiku, spend });

    expect(result).toEqual({ ok: false, notAppointment: true, reason: 'not_appointment' });
    expect(haiku).not.toHaveBeenCalled();
    expect(spend.map((r) => r.model)).toEqual(['jev-1.13.0']);
  });

  it('uses Haiku’s answer, yes or no, when Jev is under 0.8', async () => {
    const yes = await read({ jev: jevSays('not_appointment', 0.7), haiku: haikuSays({ ok: true, value: cleaning }) });
    expect(yes).toMatchObject({ ok: true, source: 'llm', value: { event: 'booked' } });

    const no = await read({ jev: jevSays('booked', 0.7), haiku: haikuSays({ ok: false, notAppointment: true }) });
    expect(no).toEqual({ ok: false, notAppointment: true, reason: 'not_appointment' });
  });

  it('uses Haiku’s answer when the Jev call fails', async () => {
    const spend: SpendReport[] = [];
    const result = await read({ jev: jevDown, haiku: haikuSays({ ok: true, value: cleaning }), spend });
    expect(result).toMatchObject({ ok: true, source: 'llm', value: { event: 'booked' } });
    expect(spend.map((r) => r.model)).toEqual(['claude-haiku-5-5']);
  });

  it('never calls Jev for an account that has not opted in', async () => {
    const jev = jevSays('not_appointment', 0.99);
    const result = await read({ jev, haiku: haikuSays({ ok: true, value: cleaning }), jevEnabled: false });
    expect(jev).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, value: { event: 'booked' } });
  });

  it('reads the fields by heuristic under Jev’s event when Haiku cannot', async () => {
    const result = await read({ jev: jevSays('rescheduled', 0.9), haiku: haikuSays(null) });
    expect(result).toMatchObject({ ok: true, source: 'heuristic', value: { event: 'rescheduled', date: '2026-10-07' } });
  });

  it('does not file a booking with no day because Jev named the event', async () => {
    const noDay = { ...cleaning, event: 'cancelled' as const, date: null, time: null };
    const result = await read({
      jev: jevSays('booked', 0.95),
      haiku: haikuSays({ ok: true, value: noDay }),
      text: 'See you soon.',
    });
    expect(result).toEqual({ ok: false, notAppointment: false, reason: 'no_extraction' });
  });
});

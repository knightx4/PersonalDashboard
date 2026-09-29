import { describe, expect, it, vi } from 'vitest';
import { jevRequestBody } from '@/lib/jev/client';
import { sortEnvelopes, stopsTheBatch } from './linker';
import { MAIL_PILE_QUESTION, MAIL_PILES, isMailPile, mailState } from './question';
import { disagrees, formatAgreement, formatDisagreements, type AgreementRow } from './report';

/** Jev answering `pile` at `confidence` for every call. Nothing reaches TypeSafe. */
function jevSays(pile: string, confidence: number) {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          model: 'jev-1.13.0',
          answers: { answer: { type: 'choice', choice: pile, confidence, probabilities: { [pile]: confidence } } },
          usage: { input_tokens: 200, output_tokens: 1 },
        }),
        { status: 200 },
      ),
  ) as unknown as typeof fetch;
}

const ENVELOPE = {
  id: 'm-1',
  fromAddress: 'no-reply@shop.example',
  replyToAddress: null,
  subject: 'Your order has shipped',
};

describe('the pile question', () => {
  it('offers the eight piles and sends them to Jev as a choice', () => {
    expect(MAIL_PILES).toEqual([
      'job',
      'order',
      'bill',
      'appointment',
      'newsletter',
      'needs_reply',
      'personal',
      'other',
    ]);
    const body = jevRequestBody({ from: 'a', subject: 'b' }, MAIL_PILE_QUESTION) as {
      questions: { answer: { type: string; criteria: Record<string, string> } };
    };
    expect(body.questions.answer.type).toBe('choice');
    expect(Object.keys(body.questions.answer.criteria)).toEqual(MAIL_PILES);
    expect(isMailPile('needs_reply')).toBe(true);
    expect(isMailPile('toString')).toBe(false);
  });

  it('reads the sender and subject, and a reply-to only when it differs', () => {
    expect(mailState(ENVELOPE)).toEqual({ from: 'no-reply@shop.example', subject: 'Your order has shipped' });
    expect(mailState({ ...ENVELOPE, replyToAddress: 'help@shop.example' })).toMatchObject({
      reply_to: 'help@shop.example',
    });
    expect(mailState({ ...ENVELOPE, replyToAddress: 'NO-REPLY@shop.example' })).not.toHaveProperty('reply_to');
  });

  it('has nothing to read on a scrubbed envelope', () => {
    expect(mailState({ fromAddress: null, replyToAddress: null, subject: '  ' })).toBeNull();
  });
});

describe('sorting envelopes', () => {
  it('stores Jev\'s pile at any confidence and reports the cost', async () => {
    const result = await sortEnvelopes({
      userId: 'u-1',
      envelopes: [ENVELOPE, { ...ENVELOPE, id: 'm-2' }],
      apiKey: 'key',
      fetch: jevSays('order', 0.55),
    });
    expect(result.rows).toEqual([
      { id: 'm-1', user_id: 'u-1', pile: 'order', confidence: 0.55, model: 'jev-1.13.0' },
      { id: 'm-2', user_id: 'u-1', pile: 'order', confidence: 0.55, model: 'jev-1.13.0' },
    ]);
    expect(result.spend).toHaveLength(2);
    expect(result.skipped).toBe(0);
  });

  it('skips a scrubbed envelope without asking', async () => {
    const fetch = jevSays('other', 0.9);
    const result = await sortEnvelopes({
      userId: 'u-1',
      envelopes: [{ id: 'm-3', fromAddress: null, replyToAddress: null, subject: null }],
      apiKey: 'key',
      fetch,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(result).toMatchObject({ rows: [], skipped: 1 });
  });

  it('writes nothing and stops at a missing key', async () => {
    const saved = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      const fetch = jevSays('order', 0.9);
      const result = await sortEnvelopes({ userId: 'u-1', envelopes: [ENVELOPE], fetch });
      expect(fetch).not.toHaveBeenCalled();
      expect(result.rows).toEqual([]);
      expect(result.failed).toEqual({ 'no-key': 1 });
    } finally {
      if (saved !== undefined) process.env.TYPESAFE_API_KEY = saved;
    }
  });

  it('leaves the rest of the page for the sweep once time runs out', async () => {
    const fetch = jevSays('job', 0.95);
    const result = await sortEnvelopes({
      userId: 'u-1',
      envelopes: [ENVELOPE],
      apiKey: 'key',
      fetch,
      deadline: 100,
      now: () => 200,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it('stops the batch only for failures every call would share', () => {
    expect(stopsTheBatch({ reason: 'no-key', detail: '' })).toBe(true);
    expect(stopsTheBatch({ reason: 'refused', detail: '401: bad key' })).toBe(true);
    expect(stopsTheBatch({ reason: 'refused', detail: '422: too long' })).toBe(false);
    expect(stopsTheBatch({ reason: 'rate-limited', detail: '429' })).toBe(false);
  });
});

describe('the report', () => {
  it('counts a pile no linker owns as agreeing when no rule claimed the email', () => {
    expect(disagrees({ pile: 'newsletter', rule_piles: [] })).toBe(false);
    expect(disagrees({ pile: 'order', rule_piles: ['order', 'bill'] })).toBe(false);
    expect(disagrees({ pile: 'bill', rule_piles: [] })).toBe(true);
    expect(disagrees({ pile: 'needs_reply', rule_piles: ['job'] })).toBe(true);
  });

  it('lays out one line per linker with the share that agree', () => {
    const row: AgreementRow = {
      linker: 'recurring',
      pile: 'bill',
      rules: 10,
      jev: 12,
      jev_sure: 9,
      agree: 8,
      rules_only: 2,
      jev_only: 4,
      jev_only_sure: 1,
      agreement: '0.571',
    };
    const text = formatAgreement([row, { ...row, linker: null, pile: 'other', agreement: null }], 40);
    expect(text).toContain('40 emails sorted by Jev');
    expect(text).toMatch(/recurring\s+bill\s+10\s+12 \(9\)\s+8\s+2\s+4 \(1\)\s+57%/);
    expect(text).toMatch(/\(none\)\s+other.*-$/m);
    expect(formatAgreement([], 0)).toBe('Jev has not sorted any email for this account yet.');
  });

  it('lists only the emails the two disagree on', () => {
    const text = formatDisagreements(
      [
        { message_id: 'a', received_at: null, from_address: 'x@y', subject: 'Invoice', pile: 'bill', confidence: 0.91, rule_piles: [] },
        { message_id: 'b', received_at: null, from_address: 'x@y', subject: 'Hi', pile: 'personal', confidence: 0.8, rule_piles: [] },
      ],
      10,
    );
    expect(text).toBe('jev bill 0.91, rules none: x@y | Invoice');
  });
});

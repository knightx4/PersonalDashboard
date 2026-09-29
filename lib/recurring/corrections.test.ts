import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { billTitle } from '@/lib/todo/agenda/sources/bills';
import { extractRecurringFromEmail } from './extract';
import { classifyRecurring } from './rules';
import { mergePayments, moveCharges, renamePayment, setPaymentCounted } from './corrections';
import type { RecurringPayment } from './load';
import { memoryClient, type Row } from './memory-client';
import { fileRecurringReading, resummarisePayment } from './store';
import { buildRecurringView, priceRise } from './view';

const USER = 'user-1';

function tablesWithUI(): Record<string, Row[]> {
  return {
    recurring_payments: [
      {
        id: 'ui',
        user_id: USER,
        payee: 'UI',
        payee_key: 'ui',
        kind: 'bill',
        status: 'active',
        amount_cents: 8400,
        currency: 'USD',
      },
    ],
    recurring_payee_aliases: [],
    recurring_charges: [],
  };
}

describe('renamePayment', () => {
  it('changes the name shown and keeps the key the mail wrote', async () => {
    const tables = tablesWithUI();
    const result = await renamePayment(memoryClient(tables), {
      userId: USER,
      paymentId: 'ui',
      payee: '  Eversource   Electric ',
    });
    expect(result).toEqual({});
    expect(tables.recurring_payments[0]).toMatchObject({
      payee: 'Eversource Electric',
      payee_key: 'ui',
    });
    expect(billTitle(tables.recurring_payments[0] as Parameters<typeof billTitle>[0])).toBe(
      'Eversource Electric bill due, $84.00',
    );
  });

  it('files a new bill under the old name on the renamed row', async () => {
    const tables = tablesWithUI();
    const client = memoryClient(tables);
    await renamePayment(client, { userId: USER, paymentId: 'ui', payee: 'Eversource' });

    const { paymentId } = await fileRecurringReading(client, {
      userId: USER,
      messageId: 'm-oct',
      senderDomain: 'ui.example',
      reading: {
        payee: 'UI',
        kind: 'bill',
        event: 'bill',
        amountCents: 9100,
        previousAmountCents: null,
        currency: 'USD',
        period: 'month',
        occurredOn: '2026-10-01',
        dueOn: '2026-10-20',
      },
    });

    expect(paymentId).toBe('ui');
    expect(tables.recurring_payments).toHaveLength(1);
    expect(tables.recurring_payments[0]).toMatchObject({ payee: 'Eversource' });
  });

  it('refuses an empty name', async () => {
    const tables = tablesWithUI();
    const result = await renamePayment(memoryClient(tables), {
      userId: USER,
      paymentId: 'ui',
      payee: '   ',
    });
    expect(result.error).toBeTruthy();
    expect(tables.recurring_payments[0]).toMatchObject({ payee: 'UI' });
  });

  it("does not rename another person's payment", async () => {
    const tables = tablesWithUI();
    const result = await renamePayment(memoryClient(tables), {
      userId: 'someone-else',
      paymentId: 'ui',
      payee: 'Mine now',
    });
    expect(result.error).toBeTruthy();
    expect(tables.recurring_payments[0]).toMatchObject({ payee: 'UI' });
  });
});

/**
 * Mail filed "YouTube Premium" for five months and plain "YouTube" for three
 * (March to July, then August to October): one subscription under two names.
 */
function tablesWithYouTube(): Record<string, Row[]> {
  const payment = (id: string, payee: string, key: string): Row => ({
    id,
    user_id: USER,
    payee,
    payee_key: key,
    kind: 'subscription',
    status: 'active',
    amount_cents: 1399,
    currency: 'USD',
    period: 'month',
  });
  const charge = (paymentId: string, month: string): Row => ({
    id: `c-${paymentId}-${month}`,
    user_id: USER,
    payment_id: paymentId,
    message_id: `m-${paymentId}-${month}`,
    event: 'charge',
    amount_cents: 1399,
    previous_amount_cents: null,
    currency: 'USD',
    period: 'month',
    occurred_on: `2026-${month}-14`,
    due_on: null,
    created_at: `2026-${month}-14T09:00:00Z`,
  });
  return {
    recurring_payments: [
      payment('premium', 'YouTube Premium', 'youtubepremium'),
      payment('plain', 'YouTube', 'youtube'),
    ],
    recurring_payee_aliases: [
      // An earlier rename had pointed "YT" at the plain row.
      { id: 'a-yt', user_id: USER, payee_key: 'yt', payment_id: 'plain' },
    ],
    recurring_charges: [
      ...['03', '04', '05', '06', '07'].map((m) => charge('premium', m)),
      ...['08', '09', '10'].map((m) => charge('plain', m)),
    ],
  };
}

const youtubeReading = (payee: string, month: string) => ({
  userId: USER,
  messageId: `m-new-${payee}-${month}`,
  senderDomain: 'youtube.com',
  reading: {
    payee,
    kind: 'subscription' as const,
    event: 'charge' as const,
    amountCents: 1399,
    previousAmountCents: null,
    currency: 'USD',
    period: 'month' as const,
    occurredOn: `2026-${month}-14`,
    dueOn: null,
  },
});

describe('mergePayments', () => {
  it('leaves one row with every charge of both and the next date from them all', async () => {
    const tables = tablesWithYouTube();
    const result = await mergePayments(memoryClient(tables), {
      userId: USER,
      paymentId: 'plain',
      intoId: 'premium',
    });

    expect(result).toEqual({});
    expect(tables.recurring_payments).toHaveLength(1);
    expect(tables.recurring_payments[0]).toMatchObject({
      id: 'premium',
      payee: 'YouTube Premium',
      amount_cents: 1399,
      period: 'month',
      last_charged_on: '2026-10-14',
      next_date: '2026-11-14',
      status: 'active',
    });
    expect(tables.recurring_charges).toHaveLength(8);
    expect(tables.recurring_charges.every((c) => c.payment_id === 'premium')).toBe(true);
  });

  it('files a later email under the merged name on the kept row', async () => {
    const tables = tablesWithYouTube();
    const client = memoryClient(tables);
    await mergePayments(client, { userId: USER, paymentId: 'plain', intoId: 'premium' });

    const plain = await fileRecurringReading(client, youtubeReading('YouTube', '11'));
    const yt = await fileRecurringReading(client, youtubeReading('YT', '12'));

    expect(plain.paymentId).toBe('premium');
    expect(yt.paymentId).toBe('premium');
    expect(tables.recurring_payments).toHaveLength(1);
    expect(tables.recurring_charges).toHaveLength(10);
    expect(tables.recurring_payments[0]).toMatchObject({ next_date: '2027-01-14' });
    expect(tables.recurring_payee_aliases.map((a) => [a.payee_key, a.payment_id]).sort()).toEqual([
      ['youtube', 'premium'],
      ['yt', 'premium'],
    ]);
  });

  it('refuses to merge a payment into itself', async () => {
    const tables = tablesWithYouTube();
    const result = await mergePayments(memoryClient(tables), {
      userId: USER,
      paymentId: 'plain',
      intoId: 'plain',
    });
    expect(result.error).toBeTruthy();
    expect(tables.recurring_payments).toHaveLength(2);
  });

  it("does not merge another person's payments", async () => {
    const tables = tablesWithYouTube();
    const result = await mergePayments(memoryClient(tables), {
      userId: 'someone-else',
      paymentId: 'plain',
      intoId: 'premium',
    });
    expect(result.error).toBeTruthy();
    expect(tables.recurring_payments).toHaveLength(2);
    expect(tables.recurring_charges.filter((c) => c.payment_id === 'plain')).toHaveLength(3);
  });
});

/**
 * One "Apple" row holding two subscriptions: a $9.99 one on the 5th and a
 * $3.99 one on the 2nd. Worked out together, the $9.99 charges read as rises
 * from $3.99.
 */
async function tablesWithApple(): Promise<Record<string, Row[]>> {
  const charge = (id: string, day: string, cents: number): Row => ({
    id,
    user_id: USER,
    payment_id: 'apple',
    message_id: `m-${id}`,
    event: 'charge',
    amount_cents: cents,
    previous_amount_cents: null,
    currency: 'USD',
    period: null,
    occurred_on: day,
    due_on: null,
    created_at: `${day}T09:00:00Z`,
  });
  const tables: Record<string, Row[]> = {
    recurring_payments: [
      {
        id: 'apple',
        user_id: USER,
        payee: 'Apple',
        payee_key: 'apple',
        kind: 'subscription',
        sender_domain: 'apple.com',
        status: 'active',
        currency: 'USD',
      },
      {
        id: 'icloud',
        user_id: USER,
        payee: 'iCloud+',
        payee_key: 'icloud',
        kind: 'subscription',
        status: 'active',
        currency: 'USD',
      },
    ],
    recurring_payee_aliases: [],
    recurring_charges: [
      charge('a-jul', '2026-07-05', 999),
      charge('b-aug', '2026-08-02', 399),
      charge('a-aug', '2026-08-05', 999),
      charge('b-sep', '2026-09-02', 399),
      charge('a-sep', '2026-09-05', 999),
    ],
  };
  await resummarisePayment(memoryClient(tables), { userId: USER, paymentId: 'apple' });
  return tables;
}

/** A payment as the loader returns it, read back from the fake's rows. */
function loaded(tables: Record<string, Row[]>, id: string): RecurringPayment {
  const p = tables.recurring_payments.find((r) => r.id === id)!;
  return {
    id,
    payee: p.payee as string,
    kind: p.kind as RecurringPayment['kind'],
    senderDomain: (p.sender_domain as string | null) ?? null,
    amountCents: (p.amount_cents as number | null) ?? null,
    currency: p.currency as string,
    period: (p.period as RecurringPayment['period']) ?? null,
    nextDate: (p.next_date as string | null) ?? null,
    status: p.status as RecurringPayment['status'],
    lastChargedOn: (p.last_charged_on as string | null) ?? null,
    charges: tables.recurring_charges
      .filter((c) => c.payment_id === id)
      .sort((a, b) => ((a.occurred_on as string) < (b.occurred_on as string) ? 1 : -1))
      .map((c) => ({
        id: c.id as string,
        messageId: c.message_id as string,
        event: c.event as RecurringPayment['charges'][number]['event'],
        amountCents: c.amount_cents as number,
        previousAmountCents: (c.previous_amount_cents as number | null) ?? null,
        currency: c.currency as string,
        period: null,
        occurredOn: c.occurred_on as string,
        dueOn: null,
      })),
  };
}

const TODAY = '2026-09-29';

describe('moveCharges', () => {
  it('splits the $3.99 charges into a new payment, and neither row shows the other as a rise', async () => {
    const tables = await tablesWithApple();
    expect(priceRise(loaded(tables, 'apple'), TODAY)).toMatchObject({ fromCents: 399 });

    const result = await moveCharges(memoryClient(tables), {
      userId: USER,
      paymentId: 'apple',
      chargeIds: ['b-aug', 'b-sep'],
      to: { payee: '  Apple   TV+ ' },
    });

    expect(result.error).toBeUndefined();
    const created = tables.recurring_payments.find((r) => r.payee === 'Apple TV+')!;
    expect(result.paymentId).toBe(created.id);
    expect(created).toMatchObject({
      payee_key: 'appletv',
      kind: 'subscription',
      sender_domain: 'apple.com',
      amount_cents: 399,
      period: 'month',
      next_date: '2026-10-02',
    });
    expect(tables.recurring_payments.find((r) => r.id === 'apple')).toMatchObject({
      amount_cents: 999,
      period: 'month',
      next_date: '2026-10-05',
    });
    expect(priceRise(loaded(tables, 'apple'), TODAY)).toBeNull();
    expect(priceRise(loaded(tables, created.id as string), TODAY)).toBeNull();
    expect(tables.recurring_payee_aliases).toHaveLength(0);
  });

  it('moves one charge to a payment already there', async () => {
    const tables = await tablesWithApple();
    const result = await moveCharges(memoryClient(tables), {
      userId: USER,
      paymentId: 'apple',
      chargeIds: ['b-sep'],
      to: { paymentId: 'icloud' },
    });
    expect(result).toEqual({ paymentId: 'icloud' });
    expect(tables.recurring_charges.find((c) => c.id === 'b-sep')!.payment_id).toBe('icloud');
    expect(tables.recurring_payments.find((r) => r.id === 'icloud')).toMatchObject({
      amount_cents: 399,
      last_charged_on: '2026-09-02',
    });
  });

  it('files onto the payment a typed name already belongs to rather than making a second', async () => {
    const tables = await tablesWithApple();
    const result = await moveCharges(memoryClient(tables), {
      userId: USER,
      paymentId: 'apple',
      chargeIds: ['b-aug'],
      to: { payee: 'iCloud' },
    });
    expect(result).toEqual({ paymentId: 'icloud' });
    expect(tables.recurring_payments).toHaveLength(2);
  });

  it('removes a payment left with no charges', async () => {
    const tables = await tablesWithApple();
    const result = await moveCharges(memoryClient(tables), {
      userId: USER,
      paymentId: 'apple',
      chargeIds: ['a-jul', 'b-aug', 'a-aug', 'b-sep', 'a-sep'],
      to: { paymentId: 'icloud' },
    });
    expect(result).toEqual({ paymentId: 'icloud' });
    expect(tables.recurring_payments.map((r) => r.id)).toEqual(['icloud']);
  });

  it('adds no alias, so the next receipt from the store still lands on the store row', async () => {
    const tables = await tablesWithApple();
    const client = memoryClient(tables);
    await moveCharges(client, {
      userId: USER,
      paymentId: 'apple',
      chargeIds: ['b-aug', 'b-sep'],
      to: { payee: 'Apple TV+' },
    });
    const { paymentId } = await fileRecurringReading(client, {
      userId: USER,
      messageId: 'm-oct',
      senderDomain: 'apple.com',
      reading: {
        payee: 'Apple',
        kind: 'subscription',
        event: 'charge',
        amountCents: 399,
        previousAmountCents: null,
        currency: 'USD',
        period: null,
        occurredOn: '2026-10-02',
        dueOn: null,
      },
    });
    expect(paymentId).toBe('apple');
  });

  it("refuses charges that are not on the payment, or not the person's", async () => {
    const tables = await tablesWithApple();
    const client = memoryClient(tables);
    const wrongRow = await moveCharges(client, {
      userId: USER,
      paymentId: 'icloud',
      chargeIds: ['b-sep'],
      to: { payee: 'Apple TV+' },
    });
    const wrongUser = await moveCharges(client, {
      userId: 'someone-else',
      paymentId: 'apple',
      chargeIds: ['b-sep'],
      to: { paymentId: 'icloud' },
    });
    expect(wrongRow.error).toBeTruthy();
    expect(wrongUser.error).toBeTruthy();
    expect(tables.recurring_charges.every((c) => c.payment_id === 'apple')).toBe(true);
    expect(tables.recurring_payments).toHaveLength(2);
  });

  it('refuses to move charges onto the payment they are on', async () => {
    const tables = await tablesWithApple();
    const result = await moveCharges(memoryClient(tables), {
      userId: USER,
      paymentId: 'apple',
      chargeIds: ['b-sep'],
      to: { payee: 'Apple' },
    });
    expect(result.error).toBeTruthy();
  });
});

function tablesWithChase(): Record<string, Row[]> {
  const payment = (id: string, payee: string, key: string, cents: number) => ({
    id,
    user_id: USER,
    payee,
    payee_key: key,
    kind: 'bill',
    sender_domain: 'chase.com',
    status: 'active',
    amount_cents: cents,
    currency: 'USD',
    period: 'month',
    next_date: '2026-10-20',
  });
  return {
    recurring_payments: [
      payment('chase', 'Chase', 'chase', 2423300),
      payment('chase-card', 'Chase Credit Card', 'chasecreditcard', 181200),
      payment('netflix', 'Netflix', 'netflix', 1549),
    ],
    recurring_payee_aliases: [],
    recurring_charges: [],
  };
}

function statement(payee: string, amountCents: number) {
  return {
    payee,
    kind: 'bill' as const,
    event: 'bill' as const,
    amountCents,
    previousAmountCents: null,
    currency: 'USD',
    period: 'month' as const,
    occurredOn: '2026-10-01',
    dueOn: '2026-10-25',
  };
}

function monthly(tables: Record<string, Row[]>) {
  const view = buildRecurringView(
    tables.recurring_payments.map((p) => loaded(tables, p.id as string)),
    TODAY,
  );
  return { view, cents: view.total.reduce((sum, t) => sum + t.cents, 0) };
}

describe('setPaymentCounted', () => {
  it('takes both Chase rows out of the monthly total, and the next statement does not add them back', async () => {
    const tables = tablesWithChase();
    const client = memoryClient(tables);
    expect(monthly(tables).cents).toBe(2423300 + 181200 + 1549);

    for (const id of ['chase', 'chase-card']) {
      expect(
        await setPaymentCounted(client, { userId: USER, paymentId: id, counted: false }),
      ).toEqual({});
    }
    const after = monthly(tables);
    expect(after.cents).toBe(1549);
    expect(after.view.active.map((r) => r.payee)).toEqual(['Netflix']);
    expect(after.view.ignored.map((r) => r.payee)).toEqual(['Chase', 'Chase Credit Card']);

    const { paymentId } = await fileRecurringReading(client, {
      userId: USER,
      messageId: 'm-chase-oct',
      senderDomain: 'chase.com',
      reading: statement('Chase', 312000),
    });
    expect(paymentId).toBe('chase');
    expect(tables.recurring_payments.find((p) => p.id === 'chase')).toMatchObject({
      status: 'ignored',
      amount_cents: 312000,
    });
    expect(monthly(tables).cents).toBe(1549);
  });

  it('brings a payment back into the total, worked out again from its charges', async () => {
    const tables = tablesWithChase();
    const client = memoryClient(tables);
    await setPaymentCounted(client, { userId: USER, paymentId: 'chase', counted: false });
    await fileRecurringReading(client, {
      userId: USER,
      messageId: 'm-chase-oct',
      senderDomain: 'chase.com',
      reading: statement('Chase', 90000),
    });

    expect(
      await setPaymentCounted(client, { userId: USER, paymentId: 'chase', counted: true }),
    ).toEqual({});
    expect(tables.recurring_payments.find((p) => p.id === 'chase')).toMatchObject({
      status: 'active',
      amount_cents: 90000,
    });
    expect(monthly(tables).cents).toBe(90000 + 181200 + 1549);
  });

  it("does not change another person's payment", async () => {
    const tables = tablesWithChase();
    const result = await setPaymentCounted(memoryClient(tables), {
      userId: 'someone-else',
      paymentId: 'chase',
      counted: false,
    });
    expect(result.error).toBeTruthy();
    expect(tables.recurring_payments[0]!.status).toBe('active');
  });
});

/** The saved Chase statement, claimed by the rules and read without a model. */
async function chaseStatement() {
  const raw = readFileSync(
    resolve(__dirname, '../../fixtures/emails/recurring/chase-card-statement.txt'),
    'utf8',
  );
  const subject = raw.match(/^Subject: (.*)$/m)![1]!;
  const fromAddress = raw.match(/^From: (.*)$/m)![1]!;
  const text = raw.replace(/^(?:Subject|From): .*\n/gm, '').trim();
  const verdict = classifyRecurring({ subject, fromAddress });
  if (!verdict.claim) throw new Error('the Chase statement was not claimed');
  const reading = await extractRecurringFromEmail({
    subject,
    text,
    fromAddress,
    receivedOn: '2026-09-28',
    hint: verdict.hint,
    haiku: async () => null,
  });
  if (!reading.ok) throw new Error(`the Chase statement was not read: ${reading.reason}`);
  return reading.value;
}

describe('a new credit card statement', () => {
  it('files a card nobody has marked yet as not counted', async () => {
    const tables: Record<string, Row[]> = {
      recurring_payments: [
        {
          id: 'netflix',
          user_id: USER,
          payee: 'Netflix',
          payee_key: 'netflix',
          kind: 'subscription',
          status: 'active',
          amount_cents: 1549,
          currency: 'USD',
          period: 'month',
        },
      ],
      recurring_payee_aliases: [],
      recurring_charges: [],
    };
    const reading = await chaseStatement();
    expect(reading).toMatchObject({
      kind: 'bill',
      event: 'bill',
      amountCents: 181200,
      cardStatement: true,
    });

    const { paymentId } = await fileRecurringReading(memoryClient(tables), {
      userId: USER,
      messageId: 'm-chase-sep',
      senderDomain: 'chase.com',
      reading,
    });

    expect(tables.recurring_payments.find((p) => p.id === paymentId)).toMatchObject({
      payee: 'Chase',
      status: 'ignored',
      amount_cents: 181200,
    });
    const { view, cents } = monthly(tables);
    expect(cents).toBe(1549);
    expect(view.ignored.map((r) => r.payee)).toEqual(['Chase']);
  });

  it('keeps a card the person put back into the total counted', async () => {
    const tables = tablesWithChase();
    const client = memoryClient(tables);
    await setPaymentCounted(client, { userId: USER, paymentId: 'chase', counted: false });
    await setPaymentCounted(client, { userId: USER, paymentId: 'chase', counted: true });

    const { paymentId } = await fileRecurringReading(client, {
      userId: USER,
      messageId: 'm-chase-sep',
      senderDomain: 'chase.com',
      reading: await chaseStatement(),
    });

    expect(paymentId).toBe('chase');
    expect(tables.recurring_payments.find((p) => p.id === 'chase')).toMatchObject({
      status: 'active',
      amount_cents: 181200,
    });
    expect(monthly(tables).view.ignored).toEqual([]);
  });

  it('flags a statement the model read without saying it was a card', async () => {
    const raw = readFileSync(
      resolve(__dirname, '../../fixtures/emails/recurring/chase-card-statement.txt'),
      'utf8',
    );
    const reading = await extractRecurringFromEmail({
      subject: 'Your credit card statement is available',
      text: raw,
      fromAddress: 'Chase <no.reply.alerts@chase.com>',
      receivedOn: '2026-09-28',
      hint: 'bill',
      haiku: async () => ({
        ok: true,
        value: { ...statement('Chase Sapphire', 181200), cardStatement: false },
      }),
    });
    expect(reading).toMatchObject({
      ok: true,
      source: 'llm',
      value: { payee: 'Chase Sapphire', cardStatement: true },
    });
  });

  it('files an ordinary bill as counted', async () => {
    const tables: Record<string, Row[]> = {
      recurring_payments: [],
      recurring_payee_aliases: [],
      recurring_charges: [],
    };
    await fileRecurringReading(memoryClient(tables), {
      userId: USER,
      messageId: 'm-coned',
      senderDomain: 'coned.com',
      reading: statement('Con Edison', 8412),
    });
    expect(tables.recurring_payments).toMatchObject([{ payee: 'Con Edison', status: 'active' }]);
  });
});

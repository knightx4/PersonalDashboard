import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { payeeKey, type RecurringExtraction, type RecurringKind } from './extraction';
import { summariseCharges, type ChargeRow } from './summarise';

/**
 * Filing one reading: the payment it is about, the charge row for the email,
 * and the payment's state worked out again from all its charges.
 *
 * Service role only (the linker runs in the sync), so every read and write
 * names the user explicitly rather than leaning on RLS.
 */

type ChargeDbRow = {
  id: string;
  event: ChargeRow['event'];
  amount_cents: number | null;
  previous_amount_cents: number | null;
  currency: string;
  period: ChargeRow['period'];
  occurred_on: string;
  due_on: string | null;
  created_at: string;
};

export async function fileRecurringReading(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    messageId: string;
    senderDomain: string | null;
    reading: RecurringExtraction;
  },
): Promise<{ paymentId: string; chargeId: string | null }> {
  const { userId, reading } = opts;
  const key = payeeKey(reading.payee);

  const paymentId = await ensurePayment(supabase, {
    userId,
    key,
    payee: reading.payee,
    kind: reading.kind,
    senderDomain: opts.senderDomain,
    currency: reading.currency,
  });

  // One row per email (recurring_charges_message_uq). A message read twice,
  // on a retried page, hits the key and changes nothing.
  const { data: inserted, error: insertError } = await supabase
    .from('recurring_charges')
    .insert({
      user_id: userId,
      payment_id: paymentId,
      message_id: opts.messageId,
      event: reading.event,
      amount_cents: reading.amountCents,
      previous_amount_cents: reading.event === 'price_change' ? reading.previousAmountCents : null,
      currency: reading.currency,
      period: reading.period,
      occurred_on: reading.occurredOn,
      due_on: reading.dueOn,
    })
    .select('id');
  if (insertError && insertError.code !== '23505') {
    throw new Error(`recurring charge insert failed: ${insertError.message}`);
  }

  await resummarisePayment(supabase, { userId, paymentId });

  const chargeId = (inserted?.[0]?.id as string | undefined) ?? null;
  return { paymentId, chargeId };
}

async function ensurePayment(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    key: string;
    payee: string;
    kind: RecurringKind;
    senderDomain: string | null;
    currency: string;
  },
): Promise<string> {
  const { data: existing, error } = await supabase
    .from('recurring_payments')
    .select('id')
    .eq('user_id', opts.userId)
    .eq('payee_key', opts.key)
    .maybeSingle();
  if (error) throw new Error(`recurring payment lookup failed: ${error.message}`);
  if (existing) return existing.id as string;

  // Two readings of the same new payee in one page race here; the unique key
  // makes the loser read the winner's row instead of failing.
  const { data: created, error: createError } = await supabase
    .from('recurring_payments')
    .upsert(
      {
        user_id: opts.userId,
        payee: opts.payee.slice(0, 200),
        payee_key: opts.key,
        kind: opts.kind,
        sender_domain: opts.senderDomain,
        currency: opts.currency,
      },
      { onConflict: 'user_id,payee_key', ignoreDuplicates: true },
    )
    .select('id');
  if (createError) throw new Error(`recurring payment insert failed: ${createError.message}`);
  if (created?.[0]?.id) return created[0].id as string;

  const { data: again } = await supabase
    .from('recurring_payments')
    .select('id')
    .eq('user_id', opts.userId)
    .eq('payee_key', opts.key)
    .single();
  return again!.id as string;
}

/** Set the payment's amount, period, next date and status from its charges. */
export async function resummarisePayment(
  supabase: SupabaseClient,
  opts: { userId: string; paymentId: string },
): Promise<void> {
  const [{ data: payment }, { data: rows, error }] = await Promise.all([
    supabase
      .from('recurring_payments')
      .select('kind')
      .eq('id', opts.paymentId)
      .eq('user_id', opts.userId)
      .single(),
    supabase
      .from('recurring_charges')
      .select(
        'id, event, amount_cents, previous_amount_cents, currency, period, occurred_on, due_on, created_at',
      )
      .eq('payment_id', opts.paymentId)
      .eq('user_id', opts.userId),
  ]);
  if (error) throw new Error(`recurring charges read failed: ${error.message}`);

  const charges: ChargeRow[] = ((rows ?? []) as ChargeDbRow[]).map((r) => ({
    id: r.id,
    event: r.event,
    amountCents: r.amount_cents,
    previousAmountCents: r.previous_amount_cents,
    currency: r.currency,
    period: r.period,
    occurredOn: r.occurred_on,
    dueOn: r.due_on,
    createdAt: r.created_at,
  }));

  const summary = summariseCharges((payment?.kind as RecurringKind) ?? 'subscription', charges);

  for (const [chargeId, previous] of summary.previousAmounts) {
    await supabase
      .from('recurring_charges')
      .update({ previous_amount_cents: previous })
      .eq('id', chargeId)
      .eq('user_id', opts.userId);
  }

  const { error: updateError } = await supabase
    .from('recurring_payments')
    .update({
      amount_cents: summary.amountCents,
      currency: summary.currency,
      period: summary.period,
      next_date: summary.nextDate,
      status: summary.status,
      last_charged_on: summary.lastChargedOn,
      updated_at: new Date().toISOString(),
    })
    .eq('id', opts.paymentId)
    .eq('user_id', opts.userId);
  if (updateError) throw new Error(`recurring payment update failed: ${updateError.message}`);
}

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { recordScheduled, scheduledBefore, scheduledChanged } from '@/lib/core/scheduled-actions';
import { payeeKey, type RecurringExtraction, type RecurringKind } from './extraction';
import { addedSummary, paymentRef, updatedSummary, UPDATED_NO_UNDO } from './record';
import { summariseCharges, type ChargeRow } from './summarise';

/**
 * Filing one reading: the payment it is about, the charge row for the email,
 * and the payment's state worked out again from all its charges.
 *
 * Service role only (the linker runs in the sync), so every read and write
 * names the user explicitly rather than leaning on RLS.
 *
 * With `record`, what the filing did to the payment is recorded as a scheduled
 * change Home lists (plan #1571): a payment the email added, with an Undo that
 * removes it and its charge, or one whose amount or dates it changed, with
 * the sentence saying why that has none. A filing that changed nothing (the
 * same email read twice) records nothing.
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
    /** Record the change as Dash's, on the scheduled surface. The sync sets it. */
    record?: boolean;
  },
): Promise<{ paymentId: string; chargeId: string | null }> {
  const { userId, reading } = opts;
  const key = payeeKey(reading.payee);

  const { id: paymentId, created } = await ensurePayment(supabase, {
    userId,
    key,
    payee: reading.payee,
    kind: reading.kind,
    senderDomain: opts.senderDomain,
    currency: reading.currency,
    cardStatement: reading.cardStatement === true,
  });
  const ref = paymentRef(paymentId);
  const before = opts.record && !created ? await scheduledBefore(supabase, userId, ref) : null;

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

  if (opts.record && created) {
    await recordScheduled(supabase, userId, {
      kind: 'file_recurring_payment',
      subjectRef: ref,
      op: 'insert',
      summary: addedSummary(reading.payee, reading, reading.cardStatement === true),
    });
  } else if (opts.record && (await scheduledChanged(supabase, userId, ref, before))) {
    await recordScheduled(supabase, userId, {
      kind: 'update_recurring_payment',
      subjectRef: ref,
      op: 'update',
      summary: updatedSummary(typeof before?.payee === 'string' ? before.payee : reading.payee, reading),
      beforeValues: before,
      noUndo: UPDATED_NO_UNDO,
    });
  }

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
    cardStatement: boolean;
  },
): Promise<{ id: string; created: boolean }> {
  // A key the person corrected (renamed, merged or moved on the Recurring
  // page) files onto the payment they chose, not a new row under the name the
  // mail gives (plan #1208).
  const { data: alias, error: aliasError } = await supabase
    .from('recurring_payee_aliases')
    .select('payment_id')
    .eq('user_id', opts.userId)
    .eq('payee_key', opts.key)
    .maybeSingle();
  if (aliasError) throw new Error(`recurring alias lookup failed: ${aliasError.message}`);
  if (alias) return { id: alias.payment_id as string, created: false };

  const { data: existing, error } = await supabase
    .from('recurring_payments')
    .select('id')
    .eq('user_id', opts.userId)
    .eq('payee_key', opts.key)
    .maybeSingle();
  if (error) throw new Error(`recurring payment lookup failed: ${error.message}`);
  if (existing) return { id: existing.id as string, created: false };

  // Two readings of the same new payee in one page race here; the unique key
  // makes the loser read the winner's row instead of failing.
  //
  // A card statement is the card's balance, and what it paid for is counted
  // already, so a new card starts out of the monthly total. Only a new row:
  // a payment already there keeps the status the person gave it (plan #1214).
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
        ...(opts.cardStatement ? { status: 'ignored' } : {}),
      },
      { onConflict: 'user_id,payee_key', ignoreDuplicates: true },
    )
    .select('id');
  if (createError) throw new Error(`recurring payment insert failed: ${createError.message}`);
  if (created?.[0]?.id) return { id: created[0].id as string, created: true };

  const { data: again } = await supabase
    .from('recurring_payments')
    .select('id')
    .eq('user_id', opts.userId)
    .eq('payee_key', opts.key)
    .single();
  return { id: again!.id as string, created: false };
}

/**
 * Set the payment's amount, period, next date and status from its charges.
 * An 'ignored' payment stays ignored.
 */
export async function resummarisePayment(
  supabase: SupabaseClient,
  opts: { userId: string; paymentId: string },
): Promise<void> {
  const [{ data: payment }, { data: rows, error }] = await Promise.all([
    supabase
      .from('recurring_payments')
      .select('kind, status')
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
  // 'ignored' is the person's (left out of the total, plan #1213), and no
  // charge overrides it; the charges only decide between active and cancelled.
  const status = payment?.status === 'ignored' ? 'ignored' : summary.status;

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
      status,
      last_charged_on: summary.lastChargedOn,
      updated_at: new Date().toISOString(),
    })
    .eq('id', opts.paymentId)
    .eq('user_id', opts.userId);
  if (updateError) throw new Error(`recurring payment update failed: ${updateError.message}`);
}

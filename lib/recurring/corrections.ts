import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { payeeKey } from './extraction';
import { PAYEE_MAX } from './limits';
import { resummarisePayment } from './store';

/**
 * The person's corrections to what the mail reader filed, made from the
 * Recurring page (feature #1193). Each takes the user explicitly, so it works
 * the same with the page's client (RLS) and with the service role.
 */

export type CorrectionResult = { error?: string };

/**
 * Rename a payment (plan #1209). Only the name shown changes: payee_key stays
 * as the mail wrote it, so the next email under the old name still files onto
 * this row, and the agenda's bill entries read the new name from it.
 */
export async function renamePayment(
  supabase: SupabaseClient,
  opts: { userId: string; paymentId: string; payee: string },
): Promise<CorrectionResult> {
  const payee = opts.payee.trim().replace(/\s+/g, ' ');
  if (payee === '') return { error: 'Give the payment a name.' };
  if (payee.length > PAYEE_MAX) return { error: `Keep the name to ${PAYEE_MAX} characters.` };

  const { data, error } = await supabase
    .from('recurring_payments')
    .update({ payee, updated_at: new Date().toISOString() })
    .eq('id', opts.paymentId)
    .eq('user_id', opts.userId)
    .select('id');
  if (error) return { error: `Could not rename it: ${error.message}` };
  if (!data || data.length === 0) return { error: 'That payment is no longer there.' };
  return {};
}

/**
 * Merge one payment into another (plan #1210): the two were the same thing,
 * filed under two names. Every charge of the merged payment moves to the kept
 * one, the merged payment's key becomes an alias of the kept one so the next
 * email under that name files there too, aliases that named the merged
 * payment are pointed at the kept one, and the merged row goes. The kept row
 * keeps its name and kind; its amount, period and next date are worked out
 * again from the combined charges.
 *
 * The order is chosen so a failure part way leaves nothing lost: the alias
 * goes in first, the delete (which would cascade to aliases) comes last, and
 * running the merge again finishes it.
 */
export async function mergePayments(
  supabase: SupabaseClient,
  opts: { userId: string; paymentId: string; intoId: string },
): Promise<CorrectionResult> {
  const { userId, paymentId, intoId } = opts;
  if (paymentId === intoId) return { error: 'Pick a different payment to merge it into.' };

  const { data: rows, error: readError } = await supabase
    .from('recurring_payments')
    .select('id, payee_key')
    .eq('user_id', userId)
    .in('id', [paymentId, intoId]);
  if (readError) return { error: `Could not merge them: ${readError.message}` };
  const merged = rows?.find((r) => r.id === paymentId);
  const kept = rows?.find((r) => r.id === intoId);
  if (!merged || !kept) return { error: 'One of those payments is no longer there.' };

  // Replace any alias already holding the merged key. An upsert would try to
  // update user_id and payee_key too, and the person may only update
  // payment_id (migration 0122).
  const key = merged.payee_key as string;
  const { error: clearError } = await supabase
    .from('recurring_payee_aliases')
    .delete()
    .eq('user_id', userId)
    .eq('payee_key', key);
  if (clearError) return { error: `Could not merge them: ${clearError.message}` };
  const { error: aliasError } = await supabase
    .from('recurring_payee_aliases')
    .insert({ user_id: userId, payee_key: key, payment_id: intoId });
  if (aliasError) return { error: `Could not merge them: ${aliasError.message}` };

  const { error: repointError } = await supabase
    .from('recurring_payee_aliases')
    .update({ payment_id: intoId })
    .eq('user_id', userId)
    .eq('payment_id', paymentId);
  if (repointError) return { error: `Could not merge them: ${repointError.message}` };

  const { error: moveError } = await supabase
    .from('recurring_charges')
    .update({ payment_id: intoId })
    .eq('user_id', userId)
    .eq('payment_id', paymentId);
  if (moveError) return { error: `Could not move the charges: ${moveError.message}` };

  const { error: deleteError } = await supabase
    .from('recurring_payments')
    .delete()
    .eq('id', paymentId)
    .eq('user_id', userId);
  if (deleteError) return { error: `Could not merge them: ${deleteError.message}` };

  try {
    await resummarisePayment(supabase, { userId, paymentId: intoId });
  } catch (e) {
    return {
      error: `Merged, but the amount could not be worked out again: ${(e as Error).message}`,
    };
  }
  return {};
}

/** Where moved charges go: a payment already there, or a new one by name. */
export type MoveTarget = { paymentId: string } | { payee: string };

/**
 * Move some of a payment's charges to another payment (plan #1211): the row
 * held more than one thing, like an "Apple" row whose receipts are for
 * several subscriptions. The target is another payment, or a new one the
 * person names; a name that is already a payment's (by its key, or an alias
 * a merge left) moves the charges there instead of making a second row.
 *
 * Both payments are worked out again from the charges each now holds, which
 * also recomputes each charge's previous amount, so neither shows a price
 * change caused by the other. A payment left with no charges is deleted.
 *
 * No alias is written: a moved charge says nothing about where the next
 * email from that sender belongs. A new payment does take the key of the
 * name typed, so mail that names it ("Apple TV+") files there.
 */
export async function moveCharges(
  supabase: SupabaseClient,
  opts: { userId: string; paymentId: string; chargeIds: readonly string[]; to: MoveTarget },
): Promise<CorrectionResult & { paymentId?: string }> {
  const { userId, paymentId } = opts;
  const chargeIds = [...new Set(opts.chargeIds)];
  if (chargeIds.length === 0) return { error: 'Pick the charges to move.' };

  const { data: source, error: sourceError } = await supabase
    .from('recurring_payments')
    .select('id, kind, sender_domain')
    .eq('user_id', userId)
    .eq('id', paymentId)
    .maybeSingle();
  if (sourceError) return { error: `Could not move them: ${sourceError.message}` };
  if (!source) return { error: 'That payment is no longer there.' };

  const { data: charges, error: chargesError } = await supabase
    .from('recurring_charges')
    .select('id, currency')
    .eq('user_id', userId)
    .eq('payment_id', paymentId)
    .in('id', chargeIds);
  if (chargesError) return { error: `Could not move them: ${chargesError.message}` };
  if (!charges || charges.length !== chargeIds.length) {
    return { error: 'Some of those charges are no longer on this payment.' };
  }

  const target = await resolveTarget(supabase, {
    userId,
    to: opts.to,
    kind: source.kind as string,
    senderDomain: (source.sender_domain as string | null) ?? null,
    currency: (charges[0]!.currency as string) ?? 'USD',
  });
  if ('error' in target) return { error: target.error };
  if (target.id === paymentId) return { error: 'Pick a different payment to move them to.' };

  const { error: moveError } = await supabase
    .from('recurring_charges')
    .update({ payment_id: target.id })
    .eq('user_id', userId)
    .eq('payment_id', paymentId)
    .in('id', chargeIds);
  if (moveError) return { error: `Could not move them: ${moveError.message}` };

  const { data: left, error: leftError } = await supabase
    .from('recurring_charges')
    .select('id')
    .eq('user_id', userId)
    .eq('payment_id', paymentId);
  if (leftError) return { error: `Moved, but could not check what is left: ${leftError.message}` };

  try {
    await resummarisePayment(supabase, { userId, paymentId: target.id });
    if (!left || left.length === 0) {
      const { error: deleteError } = await supabase
        .from('recurring_payments')
        .delete()
        .eq('id', paymentId)
        .eq('user_id', userId);
      if (deleteError) {
        return {
          error: `Moved, but the empty payment could not be removed: ${deleteError.message}`,
        };
      }
    } else {
      await resummarisePayment(supabase, { userId, paymentId });
    }
  } catch (e) {
    return {
      error: `Moved, but the amounts could not be worked out again: ${(e as Error).message}`,
    };
  }
  return { paymentId: target.id };
}

async function resolveTarget(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    to: MoveTarget;
    kind: string;
    senderDomain: string | null;
    currency: string;
  },
): Promise<{ id: string } | { error: string }> {
  const { userId, to } = opts;
  if ('paymentId' in to) {
    const { data, error } = await supabase
      .from('recurring_payments')
      .select('id')
      .eq('user_id', userId)
      .eq('id', to.paymentId)
      .maybeSingle();
    if (error) return { error: `Could not move them: ${error.message}` };
    if (!data) return { error: 'The payment you picked is no longer there.' };
    return { id: data.id as string };
  }

  const payee = to.payee.trim().replace(/\s+/g, ' ');
  if (payee === '') return { error: 'Name the new payment.' };
  if (payee.length > PAYEE_MAX) return { error: `Keep the name to ${PAYEE_MAX} characters.` };
  const key = payeeKey(payee);

  // A name that is already a payment's, by the key the mail would give it or
  // by an alias, is that payment: two rows under one key cannot exist.
  const { data: alias, error: aliasError } = await supabase
    .from('recurring_payee_aliases')
    .select('payment_id')
    .eq('user_id', userId)
    .eq('payee_key', key)
    .maybeSingle();
  if (aliasError) return { error: `Could not move them: ${aliasError.message}` };
  if (alias) return { id: alias.payment_id as string };

  const existing = await paymentByKey(supabase, userId, key);
  if ('error' in existing) return existing;
  if (existing.id) return { id: existing.id };

  const { data: created, error: createError } = await supabase
    .from('recurring_payments')
    .insert({
      user_id: userId,
      payee,
      payee_key: key,
      kind: opts.kind,
      sender_domain: opts.senderDomain,
      currency: opts.currency,
    })
    .select('id');
  if (createError) {
    // Mail filed a payment under that key a moment ago: use it.
    if (createError.code === '23505') {
      const again = await paymentByKey(supabase, userId, key);
      if ('error' in again) return again;
      if (again.id) return { id: again.id };
    }
    return { error: `Could not make the new payment: ${createError.message}` };
  }
  return { id: created![0]!.id as string };
}

async function paymentByKey(
  supabase: SupabaseClient,
  userId: string,
  key: string,
): Promise<{ id: string | null } | { error: string }> {
  const { data, error } = await supabase
    .from('recurring_payments')
    .select('id')
    .eq('user_id', userId)
    .eq('payee_key', key)
    .maybeSingle();
  if (error) return { error: `Could not move them: ${error.message}` };
  return { id: (data?.id as string | undefined) ?? null };
}

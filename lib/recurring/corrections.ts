import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
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

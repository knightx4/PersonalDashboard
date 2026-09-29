import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { PAYEE_MAX } from './limits';

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

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { recordScheduled } from '@/lib/core/scheduled-actions';
import { moveCharges } from './corrections';
import { extractRecurringFromEmail, type RecurringReading } from './extract';
import { namesTheStore, payeeKey } from './extraction';
import { MOVED_NO_UNDO, movedSummary, paymentRef } from './record';
import { classifyRecurring, STORE_PAYEE_KEYS } from './rules';

/**
 * Re-reading receipts that were filed under the store's own name (plan #1212).
 *
 * Apple, Google and Amazon bill for many subscriptions at once, and a receipt
 * read by the heuristic before it learned to refuse the store's name was filed
 * under "Apple" whatever it paid for. This pass fetches each such charge's
 * message again by its Gmail id, which survives the scrub of sender and
 * subject, reads it with the model, and moves the charge to the payment the
 * reading names (moveCharges, which also removes the store's row once it is
 * empty). The charge keeps its amount, event and dates.
 *
 * A charge that cannot be re-read stays where it is, and its message's verdict
 * in recurring_messages gets `error = 'reread: <why>'`. That note is what stops
 * the pass fetching it again every night, and what a person reads to find the
 * ones that are left. Once nothing is filed under a store's name, the pass
 * reads one table and stops.
 *
 * A store row the person left out of the total (status 'ignored', plan #1213)
 * is theirs to sort out and is not re-read.
 *
 * Each move is recorded as a scheduled change Home lists (plan #1571), under
 * the payment the charge now sits on, with the sentence saying why it has no
 * Undo: a move touches the charge and both payments, and the Recurring page
 * is where a charge is moved back.
 */

export const REREAD_ERROR_PREFIX = 'reread:';

export type RereadMessage = { subject: string; text: string; fromAddress: string | null };

export type RereadOutcome = {
  chargeId: string;
  messageId: string;
  occurredOn: string;
  amountCents: number | null;
  /** The payee the charge now sits under. */
  movedTo?: string;
  /** Why it stayed under the store. */
  unreadable?: string;
};

export type RereadResult = { moved: RereadOutcome[]; unreadable: RereadOutcome[] };

type ChargeRow = {
  id: string;
  message_id: string;
  occurred_on: string;
  amount_cents: number | null;
  currency?: string | null;
};

export async function rereadStoreReceipts(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    /** Ingested message ids to their Gmail ids, for the messages this mailbox holds. */
    providerIds: (messageIds: string[]) => Promise<Map<string, string>>;
    /** One message's content by Gmail id. Throws when it cannot be fetched. */
    fetchMessage: (providerMessageId: string) => Promise<RereadMessage>;
    /** The reader; replaced in tests. */
    read?: (input: Parameters<typeof extractRecurringFromEmail>[0]) => Promise<RecurringReading>;
    /** Messages read in one call, so a nightly stage stays inside its budget. */
    limit?: number;
  },
): Promise<RereadResult> {
  const { userId } = opts;
  const read = opts.read ?? extractRecurringFromEmail;
  const limit = opts.limit ?? 20;
  const result: RereadResult = { moved: [], unreadable: [] };

  const { data: payments, error: paymentsError } = await supabase
    .from('recurring_payments')
    .select('id, payee, payee_key, status')
    .eq('user_id', userId)
    .in('payee_key', [...STORE_PAYEE_KEYS]);
  if (paymentsError) throw new Error(`reread payments failed: ${paymentsError.message}`);

  let budget = limit;
  for (const payment of payments ?? []) {
    if (budget <= 0) break;
    if (payment.status === 'ignored') continue;
    const paymentId = payment.id as string;

    const { data: charges, error: chargesError } = await supabase
      .from('recurring_charges')
      .select('id, message_id, occurred_on, amount_cents, currency')
      .eq('user_id', userId)
      .eq('payment_id', paymentId);
    if (chargesError) throw new Error(`reread charges failed: ${chargesError.message}`);
    const rows = (charges ?? []) as ChargeRow[];
    if (rows.length === 0) continue;

    const { data: verdicts, error: verdictsError } = await supabase
      .from('recurring_messages')
      .select('id, error')
      .eq('user_id', userId)
      .in(
        'id',
        rows.map((c) => c.message_id),
      );
    if (verdictsError) throw new Error(`reread verdicts failed: ${verdictsError.message}`);
    const triedBefore = new Set(
      (verdicts ?? [])
        .filter((v) => typeof v.error === 'string' && v.error.startsWith(REREAD_ERROR_PREFIX))
        .map((v) => v.id as string),
    );

    const pending = rows.filter((c) => !triedBefore.has(c.message_id));
    const providerIds = await opts.providerIds(pending.map((c) => c.message_id));

    for (const charge of pending) {
      if (budget <= 0) break;
      const providerId = providerIds.get(charge.message_id);
      // Another mailbox's message: that account's run reads it.
      if (!providerId) continue;
      budget -= 1;

      const outcome: RereadOutcome = {
        chargeId: charge.id,
        messageId: charge.message_id,
        occurredOn: charge.occurred_on,
        amountCents: charge.amount_cents,
      };
      const why = await rereadOne(supabase, {
        userId,
        paymentId,
        storeKey: payment.payee_key as string,
        storeName: (payment.payee as string | null) ?? (payment.payee_key as string),
        charge,
        providerId,
        fetchMessage: opts.fetchMessage,
        read,
      });
      if ('movedTo' in why) {
        result.moved.push({ ...outcome, movedTo: why.movedTo });
        continue;
      }
      result.unreadable.push({ ...outcome, unreadable: why.unreadable });
      const { error: noteError } = await supabase
        .from('recurring_messages')
        .update({ error: `${REREAD_ERROR_PREFIX} ${why.unreadable}`.slice(0, 500) })
        .eq('user_id', userId)
        .eq('id', charge.message_id);
      if (noteError) throw new Error(`reread note failed: ${noteError.message}`);
    }
  }
  return result;
}

async function rereadOne(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    paymentId: string;
    storeKey: string;
    storeName: string;
    charge: ChargeRow;
    providerId: string;
    fetchMessage: (providerMessageId: string) => Promise<RereadMessage>;
    read: (input: Parameters<typeof extractRecurringFromEmail>[0]) => Promise<RecurringReading>;
  },
): Promise<{ movedTo: string } | { unreadable: string }> {
  let message: RereadMessage;
  try {
    message = await opts.fetchMessage(opts.providerId);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'fetch failed';
    return { unreadable: /\b404\b/.test(reason) ? 'no longer in the mailbox' : reason };
  }

  const verdict = classifyRecurring({ fromAddress: message.fromAddress, subject: message.subject });
  const reading = await opts.read({
    subject: message.subject,
    text: message.text,
    fromAddress: message.fromAddress,
    receivedOn: opts.charge.occurred_on,
    hint: verdict.claim ? verdict.hint : 'subscription',
  });
  if (!reading.ok) {
    return {
      unreadable: reading.notRecurring ? 'read as not a recurring payment' : 'no service named',
    };
  }
  const payee = reading.value.payee;
  if (namesTheStore(payee, message.fromAddress) || payeeKey(payee) === opts.storeKey) {
    return { unreadable: 'no service named' };
  }

  const moved = await moveCharges(supabase, {
    userId: opts.userId,
    paymentId: opts.paymentId,
    chargeIds: [opts.charge.id],
    to: { payee },
  });
  if (moved.error) return { unreadable: moved.error };

  if (moved.paymentId) {
    const { data: store } = await supabase
      .from('recurring_payments')
      .select('id')
      .eq('user_id', opts.userId)
      .eq('id', opts.paymentId)
      .maybeSingle();
    await recordScheduled(supabase, opts.userId, {
      kind: 'reread_recurring_charge',
      subjectRef: paymentRef(moved.paymentId),
      op: 'update',
      summary: movedSummary({
        store: opts.storeName,
        payee,
        amountCents: opts.charge.amount_cents,
        currency: opts.charge.currency ?? 'USD',
        occurredOn: opts.charge.occurred_on,
        storeRemoved: !store,
      }),
      noUndo: MOVED_NO_UNDO,
    });
  }
  return { movedTo: payee };
}
